"use client"

import { useMemo, useState } from "react"
import {
  ArrowLeft,
  Bot,
  Check,
  Clipboard,
  Download,
  FileText,
  LockKeyhole,
  MessageCircle,
  Pencil,
  RotateCcw,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import {
  analyzeOnboardingListingUrl,
  analyzeOnboardingPmsName,
  applyOnboardingStudyAnswer,
  buildOnboardingStudyPayload,
  buildOnboardingStudyTranscript,
  getOnboardingStudyQuestions,
  onboardingStudyAnswerLabel,
  ONBOARDING_STUDY_SECTIONS,
  ONBOARDING_STUDY_SKIPPED,
  type OnboardingStudyAnswers,
  type OnboardingStudyQuestion,
  type OnboardingStudyQuestionId,
  type OnboardingStudySection,
  suggestPropertyNameCorrection,
  validateOnboardingStudyAnswer,
} from "@/lib/onboarding-study"
import { cn } from "@/lib/utils"

type StudyMode = "choice" | "form" | "chat"

const SECTION_LABELS: Record<OnboardingStudySection, string> = {
  property: "Property",
  software: "Software & access",
  preferences: "Pricing preferences",
  knowledge: "Final context",
  review: "Review",
}

function answerCount(
  questions: OnboardingStudyQuestion[],
  answers: OnboardingStudyAnswers
) {
  return questions.filter((question) => answers[question.id] !== undefined)
    .length
}

function currentSection(
  question: OnboardingStudyQuestion | undefined
): OnboardingStudySection {
  return question?.section ?? "review"
}

function MethodChoice({ onChoose }: { onChoose: (mode: StudyMode) => void }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText />
            Complete the form
          </CardTitle>
          <CardDescription>
            Continue with the existing Assembly onboarding experience.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This is the control path for the study. The existing form and its
            submission behavior remain unchanged.
          </p>
        </CardContent>
        <CardFooter>
          <Button variant="outline" onClick={() => onChoose("form")}>
            <FileText data-icon="inline-start" />
            Preview form path
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageCircle />
            Chat with an onboarding guide
          </CardTitle>
          <CardDescription>
            Complete the same contract through a guided conversation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            The guide explains each step, records task status, and creates a
            reviewable payload without accessing any external system.
          </p>
        </CardContent>
        <CardFooter>
          <Button onClick={() => onChoose("chat")}>
            <MessageCircle data-icon="inline-start" />
            Start guided chat
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}

function FormControlPath({
  onChoose,
}: {
  onChoose: (mode: StudyMode) => void
}) {
  return (
    <Card className="mx-auto w-full max-w-3xl">
      <CardHeader>
        <CardTitle>Existing Assembly form</CardTitle>
        <CardDescription>
          Control experience for the onboarding study
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert>
          <FileText />
          <AlertTitle>The existing form stays authoritative</AlertTitle>
          <AlertDescription>
            The custom Assembly app is not duplicated in this repository. In a
            client study, this choice would open that existing form. This local
            preview deliberately performs no navigation or submission.
          </AlertDescription>
        </Alert>
        <p className="text-sm text-muted-foreground">
          Use this branch to confirm the method-selection experience, then test
          the guided path against the same onboarding run contract.
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" onClick={() => onChoose("choice")}>
          <ArrowLeft data-icon="inline-start" />
          Back to choices
        </Button>
        <Button onClick={() => onChoose("chat")}>
          <MessageCircle data-icon="inline-start" />
          Try guided chat
        </Button>
      </CardFooter>
    </Card>
  )
}

function ChatMessage({
  role,
  children,
}: {
  role: "assistant" | "user"
  children: React.ReactNode
}) {
  const isAssistant = role === "assistant"

  return (
    <div
      className={cn(
        "flex min-w-0 gap-3",
        isAssistant ? "justify-start" : "justify-end"
      )}
    >
      {isAssistant && (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Bot className="size-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 text-sm wrap-anywhere",
          isAssistant
            ? "bg-muted text-foreground"
            : "bg-primary text-primary-foreground"
        )}
      >
        {children}
      </div>
      {!isAssistant && (
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <UserRound className="size-4" />
        </div>
      )}
    </div>
  )
}

function QuestionComposer({
  question,
  value,
  error,
  onValueChange,
  onAnswer,
  actionLabel = "Continue",
  onCancel,
  idPrefix = "study",
}: {
  question: OnboardingStudyQuestion
  value: string
  error: string | null
  onValueChange: (value: string) => void
  onAnswer: (value: string) => void
  actionLabel?: string
  onCancel?: () => void
  idPrefix?: string
}) {
  if (question.kind === "choice") {
    return (
      <div className="flex flex-wrap gap-2">
        {question.options?.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant="outline"
            onClick={() => onAnswer(option.value)}
          >
            {option.label}
          </Button>
        ))}
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    )
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      onAnswer(value)
    }
  }

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={`${idPrefix}-${question.id}`} className="sr-only">
        {question.prompt}
      </FieldLabel>
      {question.kind === "textarea" ? (
        <Textarea
          id={`${idPrefix}-${question.id}`}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={question.placeholder}
          aria-invalid={Boolean(error)}
          rows={3}
        />
      ) : (
        <Input
          id={`${idPrefix}-${question.id}`}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={question.placeholder}
          inputMode={question.inputMode === "numeric" ? "decimal" : "text"}
          aria-invalid={Boolean(error)}
        />
      )}
      {error && <FieldDescription>{error}</FieldDescription>}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => onAnswer(value)}>
          <Send data-icon="inline-start" />
          {actionLabel}
        </Button>
        {question.optional && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => onAnswer(ONBOARDING_STUDY_SKIPPED)}
          >
            Skip
          </Button>
        )}
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </Field>
  )
}

function StatusBadge({ status }: { status: string }) {
  const label = status.replaceAll("-", " ")
  return (
    <Badge variant={status === "submitted" ? "default" : "secondary"}>
      {label}
    </Badge>
  )
}

function PayloadSummary({
  answers,
  isComplete,
  isSubmitted,
  onCopy,
  onDownloadJson,
  onDownloadTranscript,
  onSubmit,
}: {
  answers: OnboardingStudyAnswers
  isComplete: boolean
  isSubmitted: boolean
  onCopy: () => void
  onDownloadJson: () => void
  onDownloadTranscript: () => void
  onSubmit: () => void
}) {
  const payload = useMemo(() => buildOnboardingStudyPayload(answers), [answers])
  const listing = payload.listings[0]
  const pricing = payload.pricingPreferences["primary-1"]

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Assembly payload preview</CardTitle>
        <CardDescription>
          Built from the same keys normalized by migration 042
        </CardDescription>
        <CardAction>
          <Badge variant={isComplete ? "default" : "secondary"}>
            {isComplete ? "Ready to review" : "Draft"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Property</p>
          <p className="font-medium">{listing.name || "Not answered"}</p>
          <p className="text-sm text-muted-foreground">
            {answers.is_live === undefined
              ? "Status not answered"
              : listing.isLive === "yes"
                ? "Live listing"
                : "Planned listing"}
          </p>
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Systems</p>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>PMS</span>
            <span>
              {answers.has_pms === undefined
                ? "Not answered"
                : payload.hasPms === "yes"
                  ? payload.pms || "Name pending"
                  : "None"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>PriceLabs</span>
            <span>
              {answers.has_pricelabs === undefined
                ? "Not answered"
                : payload.hasPricelabs === "yes"
                  ? "Existing"
                  : "No"}
            </span>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Access tasks
          </p>
          {payload.tasks.map((task) => (
            <div
              key={task.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="capitalize">{task.id}</span>
              <StatusBadge status={task.clientStatus} />
            </div>
          ))}
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Pricing preferences
          </p>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Annual target</span>
            <span className="font-mono">
              {pricing.revenueTarget ? `$${pricing.revenueTarget}` : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Hard minimum</span>
            <span className="font-mono">
              {pricing.minimumNightlyPrice
                ? `$${pricing.minimumNightlyPrice}`
                : "—"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>Minimum stays</span>
            <span className="font-mono">
              {pricing.minStayMidweek || "—"} / {pricing.minStayWeekend || "—"}
            </span>
          </div>
        </div>

        {isComplete && (
          <Alert>
            <Check />
            <AlertTitle>Conversation complete</AlertTitle>
            <AlertDescription>
              Review or export the payload. Simulated submission only changes
              this browser view.
            </AlertDescription>
          </Alert>
        )}

        {isSubmitted && (
          <Alert>
            <ShieldCheck />
            <AlertTitle>Simulation recorded locally</AlertTitle>
            <AlertDescription>
              No Supabase, Assembly, PriceLabs, email, or invitation action was
              called.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2 border-t">
        <Button variant="outline" onClick={onCopy} disabled={!isComplete}>
          <Clipboard data-icon="inline-start" />
          Copy JSON
        </Button>
        <Button
          variant="outline"
          onClick={onDownloadJson}
          disabled={!isComplete}
        >
          <Download data-icon="inline-start" />
          JSON
        </Button>
        <Button
          variant="outline"
          onClick={onDownloadTranscript}
          disabled={!isComplete}
        >
          <FileText data-icon="inline-start" />
          Transcript
        </Button>
        <Button onClick={onSubmit} disabled={!isComplete || isSubmitted}>
          <ShieldCheck data-icon="inline-start" />
          {isSubmitted ? "Simulated" : "Simulate submission"}
        </Button>
      </CardFooter>
    </Card>
  )
}

type AnswerOrigin = "active" | "edit"

type PendingClarification =
  | {
      kind: "airbnb_url"
      origin: AnswerOrigin
      originalUrl: string
      normalizedUrl: string
      listingId: string
    }
  | {
      kind: "property_name"
      originalValue: string
      previousName: string
      proposedName: string
    }
  | {
      kind: "pms_name"
      origin: AnswerOrigin
      originalName: string
      suggestedName: string
    }

function GuidedChat({ onExit }: { onExit: () => void }) {
  const [answers, setAnswers] = useState<OnboardingStudyAnswers>({})
  const [draftValue, setDraftValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [editingQuestionId, setEditingQuestionId] =
    useState<OnboardingStudyQuestionId | null>(null)
  const [editValue, setEditValue] = useState("")
  const [editError, setEditError] = useState<string | null>(null)
  const [pendingClarification, setPendingClarification] =
    useState<PendingClarification | null>(null)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const questions = useMemo(
    () => getOnboardingStudyQuestions(answers),
    [answers]
  )
  const activeQuestion = questions.find(
    (question) => answers[question.id] === undefined
  )
  const completed = answerCount(questions, answers)
  const isComplete = activeQuestion === undefined
  const section = currentSection(activeQuestion)

  function commitAnswer(
    questionId: OnboardingStudyQuestionId,
    value: string,
    origin: AnswerOrigin
  ) {
    setAnswers((current) =>
      applyOnboardingStudyAnswer(current, questionId, value)
    )
    setIsSubmitted(false)

    if (origin === "edit") {
      setEditingQuestionId(null)
      setEditValue("")
      setEditError(null)
    } else {
      setDraftValue("")
      setError(null)
    }
  }

  function captureAnswer(
    question: OnboardingStudyQuestion,
    value: string,
    origin: AnswerOrigin
  ) {
    const setCaptureError = origin === "edit" ? setEditError : setError
    const validationError = validateOnboardingStudyAnswer(question, value)

    if (question.id === "listing_url" && value !== ONBOARDING_STUDY_SKIPPED) {
      const analysis = analyzeOnboardingListingUrl(value)

      if (analysis.kind === "invalid") {
        const correction =
          origin === "active"
            ? suggestPropertyNameCorrection(
                value,
                answers.property_name,
                question.id
              )
            : null

        if (correction) {
          const propertyQuestion = getOnboardingStudyQuestions({}).find(
            (candidate) => candidate.id === "property_name"
          )
          const correctionError = propertyQuestion
            ? validateOnboardingStudyAnswer(propertyQuestion, correction)
            : null

          if (!correctionError) {
            setPendingClarification({
              kind: "property_name",
              originalValue: value.trim(),
              previousName: answers.property_name ?? "",
              proposedName: correction,
            })
            setCaptureError(null)
            return
          }
        }

        setCaptureError(
          validationError ?? "Enter a complete http:// or https:// URL."
        )
        return
      }

      if (analysis.kind === "airbnb_hosting") {
        setPendingClarification({
          kind: "airbnb_url",
          origin,
          originalUrl: analysis.originalUrl,
          normalizedUrl: analysis.normalizedUrl,
          listingId: analysis.listingId,
        })
        setCaptureError(null)
        return
      }

      if (validationError) {
        setCaptureError(validationError)
        return
      }

      commitAnswer(question.id, analysis.normalizedUrl, origin)
      return
    }

    if (validationError) {
      setCaptureError(validationError)
      return
    }

    if (question.id === "pms_name") {
      const analysis = analyzeOnboardingPmsName(value)
      if (analysis.kind === "suggestion") {
        setPendingClarification({
          kind: "pms_name",
          origin,
          originalName: analysis.originalName,
          suggestedName: analysis.suggestedName,
        })
        setCaptureError(null)
        return
      }

      commitAnswer(
        question.id,
        analysis.kind === "known"
          ? analysis.canonicalName
          : analysis.originalName,
        origin
      )
      return
    }

    commitAnswer(question.id, value, origin)
  }

  function submitAnswer(value: string) {
    if (!activeQuestion) return
    captureAnswer(activeQuestion, value, "active")
  }

  function startEditing(question: OnboardingStudyQuestion, answer: string) {
    setEditingQuestionId(question.id)
    setEditValue(answer === ONBOARDING_STUDY_SKIPPED ? "" : answer)
    setEditError(null)
    setPendingClarification(null)
    setError(null)
  }

  function stopEditing() {
    setEditingQuestionId(null)
    setEditValue("")
    setEditError(null)
    setPendingClarification(null)
  }

  function confirmClarification() {
    if (!pendingClarification) return

    if (pendingClarification.kind === "airbnb_url") {
      commitAnswer(
        "listing_url",
        pendingClarification.normalizedUrl,
        pendingClarification.origin
      )
    } else if (pendingClarification.kind === "pms_name") {
      commitAnswer(
        "pms_name",
        pendingClarification.suggestedName,
        pendingClarification.origin
      )
    } else {
      setAnswers((current) =>
        applyOnboardingStudyAnswer(
          current,
          "property_name",
          pendingClarification.proposedName
        )
      )
      setDraftValue("")
      setError(null)
      setIsSubmitted(false)
    }

    setPendingClarification(null)
  }

  function declineClarification() {
    if (pendingClarification?.kind === "pms_name") {
      commitAnswer(
        "pms_name",
        pendingClarification.originalName,
        pendingClarification.origin
      )
    } else if (pendingClarification?.kind === "airbnb_url") {
      if (pendingClarification.origin === "edit") {
        setEditValue("")
      } else {
        setDraftValue("")
      }
    } else {
      setDraftValue("")
    }
    setPendingClarification(null)
  }

  function goBack() {
    const answeredQuestions = questions.filter(
      (question) => answers[question.id] !== undefined
    )
    const previous = answeredQuestions.at(-1)
    if (!previous) return

    setAnswers((current) => {
      const next = { ...current }
      delete next[previous.id]
      return next
    })
    setDraftValue("")
    setError(null)
    setEditingQuestionId(null)
    setEditValue("")
    setEditError(null)
    setPendingClarification(null)
    setIsSubmitted(false)
  }

  function reset() {
    setAnswers({})
    setDraftValue("")
    setError(null)
    setEditingQuestionId(null)
    setEditValue("")
    setEditError(null)
    setPendingClarification(null)
    setIsSubmitted(false)
  }

  async function copyPayload() {
    await navigator.clipboard.writeText(
      JSON.stringify(buildOnboardingStudyPayload(answers), null, 2)
    )
    toast.success("Onboarding study JSON copied")
  }

  function downloadFile(contents: string, type: string, fileName: string) {
    const blob = new Blob([contents], { type })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  function downloadPayload() {
    downloadFile(
      JSON.stringify(buildOnboardingStudyPayload(answers), null, 2),
      "application/json",
      "revfactor-onboarding-study.json"
    )
    toast.success("Onboarding study JSON downloaded")
  }

  function downloadTranscript() {
    downloadFile(
      buildOnboardingStudyTranscript(answers),
      "text/plain",
      "revfactor-onboarding-study-transcript.txt"
    )
    toast.success("Onboarding study transcript downloaded")
  }

  function simulateSubmission() {
    setIsSubmitted(true)
    toast.success("Submission simulated—no external write occurred")
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.8fr)]">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Guided onboarding</CardTitle>
          <CardDescription>
            One question at a time, mapped to the existing Assembly contract
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">
              {completed}/{questions.length} answered
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {ONBOARDING_STUDY_SECTIONS.map((item) => (
              <Badge
                key={item}
                variant={item === section ? "default" : "outline"}
              >
                {SECTION_LABELS[item]}
              </Badge>
            ))}
          </div>

          <ScrollArea className="h-[520px] rounded-2xl border bg-background">
            <div className="flex min-w-0 flex-col gap-4 p-4">
              <ChatMessage role="assistant">
                <div className="flex flex-col gap-2">
                  <p className="font-medium">
                    Welcome to RevFactor onboarding.
                  </p>
                  <p>
                    I’ll guide you through the existing steps and explain why
                    each answer matters. Please never share passwords, API keys,
                    payment details, or verification codes here.
                  </p>
                </div>
              </ChatMessage>

              {questions.map((question) => {
                const answer = answers[question.id]
                if (answer === undefined) return null

                return (
                  <div key={question.id} className="flex flex-col gap-4">
                    <ChatMessage role="assistant">
                      <div className="flex flex-col gap-2">
                        <p className="font-medium">{question.prompt}</p>
                        <p className="text-muted-foreground">
                          {question.explanation}
                        </p>
                      </div>
                    </ChatMessage>
                    <div className="flex flex-col gap-2">
                      <ChatMessage role="user">
                        {onboardingStudyAnswerLabel(question, answer)}
                      </ChatMessage>
                      {editingQuestionId === question.id ? (
                        <div className="ml-auto w-full max-w-xl rounded-xl border bg-muted/30 p-3">
                          <QuestionComposer
                            question={question}
                            value={editValue}
                            error={editError}
                            onValueChange={(value) => {
                              setEditValue(value)
                              setEditError(null)
                            }}
                            onAnswer={(value) =>
                              captureAnswer(question, value, "edit")
                            }
                            actionLabel="Save correction"
                            onCancel={stopEditing}
                            idPrefix="study-edit"
                          />
                        </div>
                      ) : (
                        <div className="flex justify-end pr-11">
                          <Button
                            type="button"
                            variant="ghost"
                            size="xs"
                            onClick={() => startEditing(question, answer)}
                            disabled={pendingClarification !== null}
                          >
                            <Pencil data-icon="inline-start" />
                            Edit answer
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {pendingClarification?.kind === "property_name" && (
                <div className="flex flex-col gap-4">
                  <ChatMessage role="user">
                    {pendingClarification.originalValue}
                  </ChatMessage>
                  <ChatMessage role="assistant">
                    <div className="flex flex-col gap-3">
                      <p>
                        That doesn’t look like a listing URL. Are you correcting
                        the property name from “
                        {pendingClarification.previousName}” to “
                        {pendingClarification.proposedName}”?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={confirmClarification}>
                          <Check data-icon="inline-start" />
                          Yes, update the name
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={declineClarification}
                        >
                          No, enter the URL
                        </Button>
                      </div>
                    </div>
                  </ChatMessage>
                </div>
              )}

              {pendingClarification?.kind === "airbnb_url" && (
                <div className="flex flex-col gap-4">
                  <ChatMessage role="user">
                    {pendingClarification.originalUrl}
                  </ChatMessage>
                  <ChatMessage role="assistant">
                    <div className="flex flex-col gap-3">
                      <p>
                        Thanks—that’s the Airbnb hosting-side URL. I found
                        listing ID {pendingClarification.listingId}. The public
                        listing URL should be:
                      </p>
                      <a
                        className="font-medium underline underline-offset-4"
                        href={pendingClarification.normalizedUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {pendingClarification.normalizedUrl}
                      </a>
                      <p>Can you confirm?</p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={confirmClarification}>
                          <Check data-icon="inline-start" />
                          Yes, use this URL
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={declineClarification}
                        >
                          No, enter another
                        </Button>
                      </div>
                    </div>
                  </ChatMessage>
                </div>
              )}

              {pendingClarification?.kind === "pms_name" && (
                <div className="flex flex-col gap-4">
                  <ChatMessage role="user">
                    {pendingClarification.originalName}
                  </ChatMessage>
                  <ChatMessage role="assistant">
                    <div className="flex flex-col gap-3">
                      <p>
                        I recognize a very similar PMS name. Did you mean “
                        {pendingClarification.suggestedName}”?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" onClick={confirmClarification}>
                          <Check data-icon="inline-start" />
                          Yes, use {pendingClarification.suggestedName}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={declineClarification}
                        >
                          No, keep {pendingClarification.originalName}
                        </Button>
                      </div>
                    </div>
                  </ChatMessage>
                </div>
              )}

              {!pendingClarification && !editingQuestionId && activeQuestion ? (
                <ChatMessage role="assistant">
                  <div className="flex flex-col gap-2">
                    <p className="font-medium">{activeQuestion.prompt}</p>
                    <p className="text-muted-foreground">
                      {activeQuestion.explanation}
                    </p>
                  </div>
                </ChatMessage>
              ) : !pendingClarification && !editingQuestionId ? (
                <ChatMessage role="assistant">
                  <div className="flex flex-col gap-2">
                    <p className="font-medium">
                      Your onboarding draft is ready.
                    </p>
                    <p>
                      Review the structured summary, then export it or simulate
                      submission. Nothing leaves this browser session.
                    </p>
                  </div>
                </ChatMessage>
              ) : null}
            </div>
          </ScrollArea>

          {activeQuestion && !editingQuestionId && !pendingClarification && (
            <QuestionComposer
              key={activeQuestion.id}
              question={activeQuestion}
              value={draftValue}
              error={error}
              onValueChange={(value) => {
                setDraftValue(value)
                setError(null)
              }}
              onAnswer={submitAnswer}
            />
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-2 border-t">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={goBack}
              disabled={completed === 0}
            >
              <ArrowLeft data-icon="inline-start" />
              Previous answer
            </Button>
            <Button variant="ghost" onClick={reset} disabled={completed === 0}>
              <RotateCcw data-icon="inline-start" />
              Reset
            </Button>
          </div>
          <Button variant="ghost" onClick={onExit}>
            Change method
          </Button>
        </CardFooter>
      </Card>

      <PayloadSummary
        answers={answers}
        isComplete={isComplete}
        isSubmitted={isSubmitted}
        onCopy={() => void copyPayload()}
        onDownloadJson={downloadPayload}
        onDownloadTranscript={downloadTranscript}
        onSubmit={simulateSubmission}
      />
    </div>
  )
}

export function OnboardingStudy() {
  const [mode, setMode] = useState<StudyMode>("choice")

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Client onboarding method study
          </h1>
          <Badge variant="secondary">Local prototype</Badge>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          Compare the existing form path with a contract-bound conversational
          guide before building any client-facing production behavior.
        </p>
      </div>

      <Alert>
        <LockKeyhole />
        <AlertTitle>Zero-write study environment</AlertTitle>
        <AlertDescription>
          This route uses synthetic session state only. It has no server action,
          database mutation, Assembly send, PriceLabs write, invitation, or
          email capability. Question wording should be checked against the live
          Assembly custom app before an external study.
        </AlertDescription>
      </Alert>

      {mode === "choice" && <MethodChoice onChoose={setMode} />}
      {mode === "form" && <FormControlPath onChoose={setMode} />}
      {mode === "chat" && <GuidedChat onExit={() => setMode("choice")} />}
    </div>
  )
}
