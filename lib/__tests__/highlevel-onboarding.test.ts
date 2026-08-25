import { afterEach, describe, expect, it, vi } from "vitest"
import { prepareHighLevelOnboardingAgreement } from "@/lib/highlevel-onboarding"

const contactId = "contact-123"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function configureHighLevel() {
  vi.stubEnv("HIGHLEVEL_API_KEY", "test-token")
  vi.stubEnv("HIGHLEVEL_LOCATION_ID", "location-123")
  vi.stubEnv("HIGHLEVEL_ONBOARDING_TEMPLATE_ID", "template-123")
  vi.stubEnv("HIGHLEVEL_ONBOARDING_SENDER_USER_ID", "user-123")
  vi.stubEnv("HIGHLEVEL_ONBOARDING_TEMPLATE_NAME", "RevFactor_Agreement")
  vi.stubEnv(
    "HIGHLEVEL_DOCUMENT_SIGNING_BASE_URL",
    "https://links.revfactor.io",
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("HighLevel inline onboarding agreement", () => {
  it("creates a contact-specific GHL signing link without email delivery", async () => {
    configureHighLevel()
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ documents: [] }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          documents: [
            {
              documentId: "document-123",
              name: "RevFactor_Agreement",
              status: "draft",
              createdAt: "2026-08-22T12:00:00.000Z",
              recipients: [{ id: contactId }],
              links: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: true,
            links: [
              {
                referenceId: "reference-123",
                documentId: "document-123",
                recipientId: contactId,
                entityName: "contacts",
              },
              {
                referenceId: "internal-reference",
                recipientId: "user-123",
                entityName: "users",
              },
            ],
          },
          201,
        ),
      )
    vi.stubGlobal("fetch", fetchMock)

    const result = await prepareHighLevelOnboardingAgreement({
      contactId,
      contactName: "Test Client",
      childListingQuantity: 0,
    })

    expect(result).toEqual({
      documentId: "document-123",
      signingUrl:
        "https://links.revfactor.io/documents/v1/reference-123?locale=en-US",
      reused: false,
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(await fetchMock.mock.calls[1][1]?.body).toContain(
      '"sendDocument":false',
    )
    expect(await fetchMock.mock.calls[3][1]?.body).toContain(
      '"medium":"link"',
    )
    expect(await fetchMock.mock.calls[3][1]?.body).toContain(
      '"documentName":"RevFactor_Agreement — Test Client"',
    )
    expect(await fetchMock.mock.calls[3][1]?.body).not.toContain(
      "client@example.com",
    )
  })

  it("reuses the latest open agreement for a repeated submit", async () => {
    configureHighLevel()
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        documents: [
          {
            documentId: "document-existing",
            name: "RevFactor_Agreement — client@example.com",
            status: "sent",
            createdAt: "2026-08-22T12:00:00.000Z",
            recipients: [{ id: contactId }],
            links: [
              {
                referenceId: "reference-existing",
                recipientId: contactId,
                entityName: "contacts",
              },
            ],
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const result = await prepareHighLevelOnboardingAgreement({
      contactId,
      contactName: "Test Client",
      childListingQuantity: 0,
    })

    expect(result).toEqual({
      documentId: "document-existing",
      signingUrl:
        "https://links.revfactor.io/documents/v1/reference-existing?locale=en-US",
      reused: true,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("uses the child-listing template only when child listings were selected", async () => {
    configureHighLevel()
    vi.stubEnv("HIGHLEVEL_ONBOARDING_CHILD_TEMPLATE_ID", "child-template-456")
    vi.stubEnv(
      "HIGHLEVEL_ONBOARDING_CHILD_TEMPLATE_NAME",
      "RevFactor_Agreement_With_Child_Listings",
    )
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ documents: [] }))
      .mockResolvedValueOnce(jsonResponse({ success: true }))
      .mockResolvedValueOnce(
        jsonResponse({
          documents: [
            {
              documentId: "document-child",
              name: "RevFactor_Agreement_With_Child_Listings",
              status: "draft",
              createdAt: "2026-08-22T12:00:00.000Z",
              recipients: [{ id: contactId }],
              links: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          links: [
            {
              referenceId: "reference-child",
              recipientId: contactId,
              entityName: "contacts",
            },
          ],
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    await prepareHighLevelOnboardingAgreement({
      contactId,
      contactName: "Child Client",
      childListingQuantity: 2,
    })

    expect(await fetchMock.mock.calls[1][1]?.body).toContain(
      '"templateId":"child-template-456"',
    )
    expect(await fetchMock.mock.calls[3][1]?.body).toContain(
      '"documentName":"RevFactor_Agreement_With_Child_Listings — Child Client"',
    )
  })
})
