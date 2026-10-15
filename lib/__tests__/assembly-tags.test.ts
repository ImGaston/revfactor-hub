import { describe, expect, it } from "vitest"
import {
  findTagsField,
  hasTagOption,
  mergeTagValues,
  resolveTagOption,
  tagValues,
  type AssemblyCustomField,
} from "@/lib/assembly"

const field: AssemblyCustomField = {
  object: "customField",
  id: "field-1",
  key: "hubApps",
  name: "Hub apps",
  type: "multiSelect",
  entityType: "client",
  order: 0,
  options: [
    { id: "opt-review", key: "listingReview", label: "Listing Review" },
    { id: "opt-other", key: "otherApp", label: "Other app" },
  ],
}
const review = field.options![0]

describe("Assembly tag helpers", () => {
  it("finds the field by key, then by name", () => {
    expect(findTagsField([field], "hubApps")?.id).toBe("field-1")
    expect(findTagsField([field], "hub APPS")?.id).toBe("field-1")
    expect(findTagsField([field], "missing")).toBeNull()
  })

  it("resolves an option by id, key, or label, ignoring case", () => {
    expect(resolveTagOption(field, "opt-review")).toBe(review)
    expect(resolveTagOption(field, "LISTINGREVIEW")).toBe(review)
    expect(resolveTagOption(field, " listing review ")).toBe(review)
    expect(resolveTagOption(field, "nope")).toBeNull()
    expect(resolveTagOption(field, "")).toBeNull()
  })

  it("detects the tag stored as an id or a key", () => {
    expect(hasTagOption(["opt-review"], review)).toBe(true)
    expect(hasTagOption(["listingReview"], review)).toBe(true)
    expect(hasTagOption(["otherApp"], review)).toBe(false)
  })

  it("reads only string arrays as tag values", () => {
    expect(tagValues(["a", 1, "b"])).toEqual(["a", "b"])
    expect(tagValues(null)).toEqual([])
    expect(tagValues("a")).toEqual([])
  })

  it("keeps existing tags and dedupes when merging as ids", () => {
    expect(mergeTagValues(field, ["otherApp", "legacy"], review, "id")).toEqual([
      "opt-other",
      "legacy",
      "opt-review",
    ])
    expect(mergeTagValues(field, ["listingReview"], review, "id")).toEqual(["opt-review"])
  })

  it("keeps existing tags and dedupes when merging as keys", () => {
    expect(mergeTagValues(field, ["opt-other", "legacy"], review, "key")).toEqual([
      "otherApp",
      "legacy",
      "listingReview",
    ])
    expect(mergeTagValues(field, ["opt-review"], review, "key")).toEqual(["listingReview"])
  })
})
