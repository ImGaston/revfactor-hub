"use client"

import { useState } from "react"

import { OwnerMessagePanel } from "./owner-message-panel"
import { ReportStatusControls } from "./report-status-controls"

/** Header controls and the owner-message panel share the message being edited. */
export function ReviewWorkspace({
  reportId,
  status,
  clientName,
  canEdit,
  channelManager,
  coverage,
  ownerMessage,
  ownerMessageSentAt,
}: {
  reportId: string
  status: string
  clientName: string | null
  canEdit: boolean
  channelManager: string | null
  coverage: { checked: number; total: number; complete: boolean }
  ownerMessage: string | null
  ownerMessageSentAt: string | null
}) {
  const [text, setText] = useState(ownerMessage ?? "")
  return (
    <>
      <ReportStatusControls
        reportId={reportId}
        status={status}
        clientName={clientName}
        canEdit={canEdit}
        channelManager={channelManager}
        coverage={coverage}
        ownerMessage={text}
        onOwnerMessageChange={setText}
        messageSent={Boolean(ownerMessageSentAt)}
      />
      <OwnerMessagePanel
        reportId={reportId}
        status={status}
        message={ownerMessage}
        sentAt={ownerMessageSentAt}
        canEdit={canEdit}
        value={text}
        onChange={setText}
      />
    </>
  )
}
