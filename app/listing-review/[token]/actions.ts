"use server"

import {
  confirmPublicListingReviewUpload,
  deletePublicListingReviewFile,
  preparePublicListingReviewUpload,
  savePublicListingReview,
  submitPublicListingReview,
} from "@/lib/listing-reviews.server"

export async function saveListingReviewAction(
  input: Parameters<typeof savePublicListingReview>[0]
) {
  return savePublicListingReview(input)
}

export async function prepareListingReviewUploadAction(
  input: Parameters<typeof preparePublicListingReviewUpload>[0]
) {
  return preparePublicListingReviewUpload(input)
}

export async function confirmListingReviewUploadAction(
  input: Parameters<typeof confirmPublicListingReviewUpload>[0]
) {
  return confirmPublicListingReviewUpload(input)
}

export async function deleteListingReviewFileAction(
  input: Parameters<typeof deletePublicListingReviewFile>[0]
) {
  return deletePublicListingReviewFile(input)
}

export async function submitListingReviewAction(
  input: Parameters<typeof submitPublicListingReview>[0]
) {
  return submitPublicListingReview(input)
}
