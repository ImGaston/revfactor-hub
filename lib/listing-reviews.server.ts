import "server-only"

import { randomUUID } from "node:crypto"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  LISTING_REVIEW_BUCKET,
  LISTING_REVIEW_MAX_FILES_PER_PROPERTY,
  ListingReviewDraftSchema,
  ListingReviewFinalSchema,
  normalizeListingReviewDraft,
  validateListingReviewFile,
  type ListingReviewDraft,
} from "@/lib/listing-reviews"

export type ListingReviewFileRecord = {
  id: string
  property_number: number
  storage_path: string
  file_name: string
  mime_type: string
  byte_size: number
  uploaded_at: string
}

export type PublicListingReview = {
  id: string
  public_token: string
  prospect_name: string
  status: "draft" | "submitted" | "in_review" | "completed" | "cancelled"
  property_count: number
  revision: number
  draft_payload: ListingReviewDraft
  submitted_at: string | null
  last_saved_at: string | null
  files: ListingReviewFileRecord[]
}

const PUBLIC_REQUEST_SELECT =
  "id, public_token, prospect_name, status, property_count, revision, draft_payload, submitted_at, last_saved_at"

export async function getPublicListingReview(
  token: string
): Promise<PublicListingReview | null> {
  if (!isUuid(token)) return null
  const admin = createAdminClient()
  const { data: request, error } = await admin
    .from("listing_review_requests")
    .select(PUBLIC_REQUEST_SELECT)
    .eq("public_token", token)
    .maybeSingle()

  if (error || !request) return null

  const { data: files } = await admin
    .from("listing_review_files")
    .select(
      "id, property_number, storage_path, file_name, mime_type, byte_size, uploaded_at"
    )
    .eq("request_id", request.id)
    .order("property_number")
    .order("uploaded_at")

  return {
    ...request,
    draft_payload: normalizeListingReviewDraft(request.draft_payload),
    files: (files ?? []) as ListingReviewFileRecord[],
  } as PublicListingReview
}

export async function savePublicListingReview(input: {
  token: string
  expectedRevision: number
  draft: unknown
}) {
  if (!isUuid(input.token))
    return { error: "This review link is invalid." } as const
  const parsed = ListingReviewDraftSchema.safeParse(input.draft)
  if (!parsed.success) return { error: firstIssue(parsed.error) } as const

  const admin = createAdminClient()
  const { data: request } = await admin
    .from("listing_review_requests")
    .select("id, status, revision")
    .eq("public_token", input.token)
    .maybeSingle()

  if (!request || request.status !== "draft") {
    return { error: "This review is no longer accepting changes." } as const
  }
  if (request.revision !== input.expectedRevision) {
    return {
      error: "A newer version was saved. Refresh before continuing.",
      conflict: true,
    } as const
  }

  const now = new Date().toISOString()
  const { data: saved, error } = await admin
    .from("listing_review_requests")
    .update({
      property_count: parsed.data.propertyCount,
      draft_payload: parsed.data,
      revision: request.revision + 1,
      last_saved_at: now,
      updated_at: now,
    })
    .eq("id", request.id)
    .eq("status", "draft")
    .eq("revision", request.revision)
    .select("revision, last_saved_at")
    .maybeSingle()

  if (error || !saved) {
    return {
      error: "The draft could not be saved. Refresh and try again.",
    } as const
  }

  await admin.from("listing_review_events").insert({
    request_id: request.id,
    event_type: "draft_saved",
    actor_type: "prospect",
    details: { revision: saved.revision },
  })

  return {
    success: true,
    revision: saved.revision,
    lastSavedAt: saved.last_saved_at,
  } as const
}

export async function preparePublicListingReviewUpload(input: {
  token: string
  propertyNumber: number
  file: { name: string; size: number; type: string }
}) {
  if (!isUuid(input.token))
    return { error: "This review link is invalid." } as const
  const fileError = validateListingReviewFile(input.file as File)
  if (fileError) return { error: fileError } as const

  const admin = createAdminClient()
  const { data: request } = await admin
    .from("listing_review_requests")
    .select("id, status, property_count")
    .eq("public_token", input.token)
    .maybeSingle()

  if (!request || request.status !== "draft") {
    return { error: "This review is no longer accepting files." } as const
  }
  if (
    input.propertyNumber < 1 ||
    input.propertyNumber > request.property_count
  ) {
    return { error: "Choose a valid property for this file." } as const
  }

  const { count } = await admin
    .from("listing_review_files")
    .select("id", { count: "exact", head: true })
    .eq("request_id", request.id)
    .eq("property_number", input.propertyNumber)
  if ((count ?? 0) >= LISTING_REVIEW_MAX_FILES_PER_PROPERTY) {
    return {
      error: `You can upload up to ${LISTING_REVIEW_MAX_FILES_PER_PROPERTY} files per property.`,
    } as const
  }

  const extension = input.file.name.toLowerCase().split(".").pop() ?? "bin"
  const storagePath = `${request.id}/${input.propertyNumber}/${randomUUID()}.${extension}`
  const { data, error } = await admin.storage
    .from(LISTING_REVIEW_BUCKET)
    .createSignedUploadUrl(storagePath)

  if (error || !data)
    return { error: "A secure upload could not be prepared." } as const

  return {
    success: true,
    path: data.path,
    uploadToken: data.token,
    mimeType: normalizedMimeType(input.file.name, input.file.type),
  } as const
}

export async function confirmPublicListingReviewUpload(input: {
  token: string
  propertyNumber: number
  storagePath: string
  file: { name: string; size: number; type: string }
}) {
  if (!isUuid(input.token))
    return { error: "This review link is invalid." } as const
  const fileError = validateListingReviewFile(input.file as File)
  if (fileError) return { error: fileError } as const

  const admin = createAdminClient()
  const { data: request } = await admin
    .from("listing_review_requests")
    .select("id, status, property_count")
    .eq("public_token", input.token)
    .maybeSingle()
  if (!request || request.status !== "draft") {
    return { error: "This review is no longer accepting files." } as const
  }

  const expectedPrefix = `${request.id}/${input.propertyNumber}/`
  if (
    input.propertyNumber < 1 ||
    input.propertyNumber > request.property_count ||
    !input.storagePath.startsWith(expectedPrefix)
  ) {
    return { error: "The uploaded file does not match this review." } as const
  }

  const folder = `${request.id}/${input.propertyNumber}`
  const objectName = input.storagePath.slice(expectedPrefix.length)
  const { data: objects, error: listError } = await admin.storage
    .from(LISTING_REVIEW_BUCKET)
    .list(folder, { search: objectName, limit: 2 })
  const object = objects?.find((candidate) => candidate.name === objectName)
  if (listError || !object)
    return { error: "The upload did not finish. Please try again." } as const

  const byteSize = Number(object.metadata?.size ?? input.file.size)
  if (byteSize !== input.file.size) {
    await admin.storage.from(LISTING_REVIEW_BUCKET).remove([input.storagePath])
    return { error: "The uploaded file size could not be verified." } as const
  }

  const mimeType = normalizedMimeType(input.file.name, input.file.type)
  const { data: record, error } = await admin
    .from("listing_review_files")
    .insert({
      request_id: request.id,
      property_number: input.propertyNumber,
      storage_path: input.storagePath,
      file_name: input.file.name.slice(0, 255),
      mime_type: mimeType,
      byte_size: byteSize,
    })
    .select(
      "id, property_number, storage_path, file_name, mime_type, byte_size, uploaded_at"
    )
    .single()

  if (error || !record) {
    await admin.storage.from(LISTING_REVIEW_BUCKET).remove([input.storagePath])
    return { error: "The file could not be attached to this review." } as const
  }

  await admin.from("listing_review_events").insert({
    request_id: request.id,
    event_type: "file_uploaded",
    actor_type: "prospect",
    details: { file_id: record.id, property_number: input.propertyNumber },
  })

  return { success: true, file: record as ListingReviewFileRecord } as const
}

export async function deletePublicListingReviewFile(input: {
  token: string
  fileId: string
}) {
  if (!isUuid(input.token) || !isUuid(input.fileId))
    return { error: "Invalid file request." } as const
  const admin = createAdminClient()
  const { data: request } = await admin
    .from("listing_review_requests")
    .select("id, status")
    .eq("public_token", input.token)
    .maybeSingle()
  if (!request || request.status !== "draft") {
    return { error: "This review is no longer accepting changes." } as const
  }

  const { data: file } = await admin
    .from("listing_review_files")
    .select("id, storage_path, property_number")
    .eq("id", input.fileId)
    .eq("request_id", request.id)
    .maybeSingle()
  if (!file) return { error: "File not found." } as const

  const { error: storageError } = await admin.storage
    .from(LISTING_REVIEW_BUCKET)
    .remove([file.storage_path])
  if (storageError)
    return { error: "The secure file could not be removed." } as const

  const { error } = await admin
    .from("listing_review_files")
    .delete()
    .eq("id", file.id)
  if (error) return { error: "The file record could not be removed." } as const

  await admin.from("listing_review_events").insert({
    request_id: request.id,
    event_type: "file_deleted",
    actor_type: "prospect",
    details: { file_id: file.id, property_number: file.property_number },
  })
  return { success: true } as const
}

export async function submitPublicListingReview(input: {
  token: string
  expectedRevision: number
  draft: unknown
}) {
  if (!isUuid(input.token))
    return { error: "This review link is invalid." } as const
  const parsed = ListingReviewFinalSchema.safeParse(input.draft)
  if (!parsed.success) return { error: firstIssue(parsed.error) } as const

  const admin = createAdminClient()
  const { data: request } = await admin
    .from("listing_review_requests")
    .select("id, status, property_count, revision")
    .eq("public_token", input.token)
    .maybeSingle()
  if (!request || request.status !== "draft") {
    return { error: "This review is no longer accepting changes." } as const
  }
  if (request.property_count !== parsed.data.propertyCount) {
    return {
      error: "Save the selected property count before submitting.",
    } as const
  }

  const { data: files } = await admin
    .from("listing_review_files")
    .select("property_number")
    .eq("request_id", request.id)
  const covered = new Set((files ?? []).map((file) => file.property_number))
  for (
    let propertyNumber = 1;
    propertyNumber <= parsed.data.propertyCount;
    propertyNumber += 1
  ) {
    if (!covered.has(propertyNumber)) {
      return {
        error: `Attach at least one financial file for property ${propertyNumber}.`,
      } as const
    }
  }

  const { data, error } = await admin.rpc("submit_listing_review", {
    p_request_id: request.id,
    p_expected_revision: input.expectedRevision,
    p_payload: parsed.data,
  })
  if (error || !data?.[0]) {
    const conflict = error?.message?.includes("revision conflict")
    return {
      error: conflict
        ? "A newer version was saved. Refresh before submitting."
        : "The review could not be submitted. Please try again.",
      conflict,
    } as const
  }

  return {
    success: true,
    revision: data[0].new_revision,
    submittedAt: data[0].submitted_at,
  } as const
}

export async function createListingReviewDownloadUrl(storagePath: string) {
  const { data, error } = await createAdminClient()
    .storage.from(LISTING_REVIEW_BUCKET)
    .createSignedUrl(storagePath, 10 * 60, { download: true })
  return error ? null : data.signedUrl
}

function normalizedMimeType(fileName: string, supplied: string) {
  if (supplied) return supplied
  const extension = fileName.toLowerCase().split(".").pop()
  if (extension === "pdf") return "application/pdf"
  if (extension === "xlsx")
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  return "text/csv"
}

function firstIssue(error: { issues: { message: string }[] }) {
  return error.issues[0]?.message ?? "Check the form and try again."
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  )
}
