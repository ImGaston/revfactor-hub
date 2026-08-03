#!/usr/bin/env python3
"""Generate RevFactor's host-side Airbnb alteration guide PDF."""

from __future__ import annotations

import shutil
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Flowable,
    Image,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "airbnb-host-side-reservation-alteration-guide.pdf"
PUBLIC_COPY = ROOT / "public" / "resources" / OUTPUT.name
LOGO = ROOT / "public" / "revfactor-logo" / "RevFactor_SecondaryLogo_Cedar.png"
STEP_1_SCREENSHOT = (
    ROOT / "public" / "resources" / "airbnb-alteration-step-1-redacted.png"
)
STEP_2_SCREENSHOT = (
    ROOT / "public" / "resources" / "airbnb-alteration-step-2-redacted.png"
)
STEP_3_SCREENSHOT = (
    ROOT / "public" / "resources" / "airbnb-alteration-step-3-redacted.png"
)
STEP_4_SCREENSHOT = (
    ROOT / "public" / "resources" / "airbnb-alteration-step-4-redacted.png"
)
STEP_5_SCREENSHOT = (
    ROOT / "public" / "resources" / "airbnb-alteration-step-5-redacted.png"
)
STEP_6_SCREENSHOT = (
    ROOT / "public" / "resources" / "airbnb-alteration-step-6-redacted.png"
)

CEDAR = colors.HexColor("#123A32")
CEDAR_DARK = colors.HexColor("#0B2A24")
MINT = colors.HexColor("#E8F4EF")
MINT_BORDER = colors.HexColor("#9FC9B8")
BONE = colors.HexColor("#F7F4EC")
INK = colors.HexColor("#1D2623")
MUTED = colors.HexColor("#5C6864")
LINE = colors.HexColor("#D9E0DD")
WHITE = colors.white


class GuideDocTemplate(BaseDocTemplate):
    def __init__(self, filename: str) -> None:
        super().__init__(
            filename,
            pagesize=letter,
            leftMargin=0.58 * inch,
            rightMargin=0.58 * inch,
            topMargin=0.48 * inch,
            bottomMargin=0.50 * inch,
            title="How to Send an Airbnb Reservation Change from the Host Side",
            author="RevFactor",
            subject="Host-side Airbnb reservation alteration guide",
        )
        frame = Frame(
            self.leftMargin,
            self.bottomMargin,
            self.width,
            self.height,
            id="guide",
            leftPadding=0,
            rightPadding=0,
            topPadding=0,
            bottomPadding=0,
        )
        self.addPageTemplates(PageTemplate(id="guide", frames=[frame], onPage=self._draw_page))

    def _draw_page(self, canvas, doc) -> None:  # type: ignore[no-untyped-def]
        canvas.saveState()
        canvas.setFillColor(BONE)
        canvas.rect(0, 0, letter[0], letter[1], fill=1, stroke=0)
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.6)
        canvas.line(doc.leftMargin, 0.36 * inch, letter[0] - doc.rightMargin, 0.36 * inch)
        canvas.setFillColor(MUTED)
        canvas.setFont("Helvetica", 7.5)
        canvas.drawString(doc.leftMargin, 0.22 * inch, "RevFactor host workflow guide | Version 1.0 | August 2026")
        page_label = f"Page {doc.page}"
        canvas.drawRightString(letter[0] - doc.rightMargin, 0.22 * inch, page_label)
        canvas.restoreState()


class AnnotatedScreenshot(Flowable):
    """Render a screenshot with crisp vector highlights over selected controls."""

    def __init__(
        self,
        path: Path,
        source_width: float,
        source_height: float,
        width: float,
        highlights: list[tuple[float, float, float, float, str]],
    ) -> None:
        super().__init__()
        self.width = width
        self.height = width * (source_height / source_width)
        self._image = ImageReader(str(path))
        self._source_width = source_width
        self._source_height = source_height
        self._highlights = highlights

    def wrap(self, available_width: float, available_height: float) -> tuple[float, float]:
        return self.width, self.height

    def draw(self) -> None:
        canvas = self.canv
        canvas.drawImage(
            self._image,
            0,
            0,
            width=self.width,
            height=self.height,
            preserveAspectRatio=True,
            mask="auto",
        )
        scale_x = self.width / self._source_width
        scale_y = self.height / self._source_height
        for x, y, width, height, badge in self._highlights:
            draw_x = x * scale_x
            draw_y = self.height - ((y + height) * scale_y)
            draw_width = width * scale_x
            draw_height = height * scale_y
            canvas.setStrokeColor(CEDAR)
            canvas.setLineWidth(2.4)
            canvas.roundRect(draw_x, draw_y, draw_width, draw_height, 5, fill=0, stroke=1)

            badge_radius = 10
            badge_x = max(badge_radius + 2, draw_x - 7)
            badge_y = draw_y + draw_height / 2
            canvas.setFillColor(CEDAR)
            canvas.circle(badge_x, badge_y, badge_radius, fill=1, stroke=0)
            canvas.setFillColor(WHITE)
            canvas.setFont("Helvetica-Bold", 9)
            canvas.drawCentredString(badge_x, badge_y - 3.2, badge)


def callout(title: str, body: str, styles: dict[str, ParagraphStyle]) -> Table:
    table = Table(
        [[Paragraph(title, styles["callout_title"])], [Paragraph(body, styles["callout_body"])]],
        colWidths=[7.34 * inch],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), MINT),
                ("BOX", (0, 0), (-1, -1), 1, MINT_BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 13),
                ("RIGHTPADDING", (0, 0), (-1, -1), 13),
                ("TOPPADDING", (0, 0), (-1, 0), 9),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
                ("TOPPADDING", (0, 1), (-1, 1), 2),
                ("BOTTOMPADDING", (0, 1), (-1, 1), 9),
            ]
        )
    )
    return table


def step_card(number: int, title: str, body: str, styles: dict[str, ParagraphStyle]) -> Table:
    circle_size = 0.43 * inch
    number_table = Table([[Paragraph(str(number), styles["step_number"])]], colWidths=[circle_size], rowHeights=[circle_size])
    number_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CEDAR),
                ("BOX", (0, 0), (-1, -1), 0.8, CEDAR),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
            ]
        )
    )
    text = [Paragraph(title, styles["step_title"]), Spacer(1, 2), Paragraph(body, styles["step_body"])]
    table = Table([[number_table, text]], colWidths=[0.62 * inch, 6.72 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.7, LINE),
                ("LEFTPADDING", (0, 0), (0, 0), 10),
                ("RIGHTPADDING", (0, 0), (0, 0), 4),
                ("LEFTPADDING", (1, 0), (1, 0), 3),
                ("RIGHTPADDING", (1, 0), (1, 0), 11),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return table


def build_pdf() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC_COPY.parent.mkdir(parents=True, exist_ok=True)

    if not STEP_1_SCREENSHOT.exists():
        raise FileNotFoundError(f"Missing Step 1 screenshot: {STEP_1_SCREENSHOT}")
    if not STEP_2_SCREENSHOT.exists():
        raise FileNotFoundError(f"Missing Step 2 screenshot: {STEP_2_SCREENSHOT}")
    if not STEP_3_SCREENSHOT.exists():
        raise FileNotFoundError(f"Missing Step 3 screenshot: {STEP_3_SCREENSHOT}")
    if not STEP_4_SCREENSHOT.exists():
        raise FileNotFoundError(f"Missing Step 4 screenshot: {STEP_4_SCREENSHOT}")
    if not STEP_5_SCREENSHOT.exists():
        raise FileNotFoundError(f"Missing Step 5 screenshot: {STEP_5_SCREENSHOT}")
    if not STEP_6_SCREENSHOT.exists():
        raise FileNotFoundError(f"Missing Step 6 screenshot: {STEP_6_SCREENSHOT}")

    base = getSampleStyleSheet()
    styles: dict[str, ParagraphStyle] = {
        "eyebrow": ParagraphStyle(
            "eyebrow",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=10,
            textColor=CEDAR,
            spaceAfter=5,
            tracking=1.1,
        ),
        "title": ParagraphStyle(
            "title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=23,
            leading=26,
            textColor=CEDAR_DARK,
            alignment=TA_LEFT,
            spaceAfter=5,
        ),
        "subtitle": ParagraphStyle(
            "subtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10.2,
            leading=14,
            textColor=MUTED,
        ),
        "pill": ParagraphStyle(
            "pill",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=8,
            leading=9,
            textColor=CEDAR,
            alignment=TA_CENTER,
        ),
        "section": ParagraphStyle(
            "section",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=13,
            leading=16,
            textColor=CEDAR_DARK,
            spaceBefore=3,
            spaceAfter=7,
        ),
        "callout_title": ParagraphStyle(
            "callout_title",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10.5,
            leading=13,
            textColor=CEDAR_DARK,
        ),
        "callout_body": ParagraphStyle(
            "callout_body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=12.3,
            textColor=INK,
        ),
        "step_number": ParagraphStyle(
            "step_number",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=13,
            textColor=WHITE,
            alignment=TA_CENTER,
        ),
        "step_title": ParagraphStyle(
            "step_title",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=11.5,
            textColor=CEDAR_DARK,
        ),
        "table_header": ParagraphStyle(
            "table_header",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9.5,
            leading=11.5,
            textColor=WHITE,
        ),
        "step_body": ParagraphStyle(
            "step_body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.4,
            leading=11.3,
            textColor=INK,
        ),
        "body": ParagraphStyle(
            "body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.7,
            leading=12,
            textColor=INK,
        ),
        "template": ParagraphStyle(
            "template",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9,
            leading=13,
            textColor=INK,
        ),
        "source": ParagraphStyle(
            "source",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=6.8,
            leading=9,
            textColor=MUTED,
        ),
        "walkthrough_title": ParagraphStyle(
            "walkthrough_title",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=21,
            leading=24,
            textColor=CEDAR_DARK,
            alignment=TA_LEFT,
            spaceAfter=7,
        ),
        "walkthrough_body": ParagraphStyle(
            "walkthrough_body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=INK,
        ),
    }

    logo = Image(str(LOGO), width=1.65 * inch, height=1.65 * inch * (1412 / 4775))
    header_text = [
        Paragraph("AIRBNB RESERVATION ALTERATIONS", styles["eyebrow"]),
        Paragraph("Send the change from the host side", styles["title"]),
        Paragraph(
            "Use this process when a guest wants to extend, shorten, or move a confirmed stay. Starting the request from the host side lets you review and correct the accommodation cost before sending it.",
            styles["subtitle"],
        ),
    ]
    header = Table([[header_text, logo]], colWidths=[5.58 * inch, 1.76 * inch])
    header.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
            ]
        )
    )

    story = [
        header,
        Spacer(1, 12),
        callout(
            "Why the host should initiate the change",
            "Airbnb may reprice the full stay when a guest initiates an alteration. With length-of-stay and other discounts active, the revised total can become lower than intended. Do not accept an incorrectly priced request. Withdraw it and send a corrected host-side change instead.",
            styles,
        ),
        Spacer(1, 10),
        Paragraph("Host-side steps", styles["section"]),
    ]

    steps = [
        (1, "Open the reservation", "In Airbnb, open the <b>Inbox</b> conversation for the guest and select the confirmed reservation."),
        (2, "Choose Manage reservation", "Open <b>Manage reservation</b> from the reservation details in the message thread."),
        (3, "Choose Change reservation", "Start a host-side trip change request. Do not accept a guest request that shows an incorrect total."),
        (4, "Enter the new dates", "Select the revised check-in and checkout dates. Confirm availability and any guest-count change before continuing."),
        (5, "Review the pricing breakdown", "Expand <b>Price difference</b>. Review the accommodation-price adjustment, Airbnb service-fee adjustment, revised host payout, and guest total before editing the cost."),
        (6, "Update the accommodation cost", "Enter the <b>full revised accommodation cost</b>. Its difference from the original cost should equal the approved price of the added nights, or the approved refund for removed nights."),
    ]
    for index, title, body in steps:
        story.extend([step_card(index, title, body, styles), Spacer(1, 5)])

    story.extend(
        [
            Spacer(1, 3),
            Paragraph("If the guest already sent an incorrectly priced request", styles["section"]),
            callout(
                "Suggested guest message",
                "<i>Hi [Guest Name], it looks like Airbnb is not pricing this alteration correctly. Please withdraw the current change request, and we will send you a corrected alteration from the host side for review.</i>",
                styles,
            ),
            Spacer(1, 9),
            Table(
                [
                    [
                        Paragraph("Before sending", styles["table_header"]),
                        Paragraph("Stop and ask for help when", styles["table_header"]),
                    ],
                    [
                        Paragraph("- Original and new dates match the request<br/>- Accommodation cost reflects the approved change<br/>- Existing booked nights retain their intended value<br/>- Payout, taxes, and fees have been reviewed", styles["body"]),
                        Paragraph("- The revised payout is unexpectedly lower<br/>- The request creates a refund or cancellation issue<br/>- A monthly stay or special cancellation rule applies<br/>- The platform preview cannot be explained", styles["body"]),
                    ],
                ],
                colWidths=[3.62 * inch, 3.62 * inch],
                style=TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), CEDAR),
                        ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                        ("BACKGROUND", (0, 1), (-1, 1), WHITE),
                        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
                        ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                        ("LEFTPADDING", (0, 0), (-1, -1), 10),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                        ("TOPPADDING", (0, 0), (-1, -1), 7),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ]
                ),
            ),
            Spacer(1, 5),
            Paragraph(
                "Airbnb interface labels can change. This guide reflects the host workflow available in August 2026. Reference: airbnb.com/help/article/1505 and airbnb.com/help/article/913.",
                styles["source"],
            ),
        ]
    )

    screenshot = Image(
        str(STEP_1_SCREENSHOT),
        width=3.35 * inch,
        height=3.35 * inch * (1694 / 929),
    )
    screenshot_frame = Table([[screenshot]], colWidths=[3.55 * inch])
    screenshot_frame.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            PageBreak(),
            Paragraph("STEP 1", styles["eyebrow"]),
            Paragraph("Open the guest's reservation", styles["walkthrough_title"]),
            Paragraph(
                "From the Airbnb Inbox, open the guest conversation and select the confirmed reservation. Scroll through the reservation details until the <b>Manage reservation</b> row is visible.",
                styles["walkthrough_body"],
            ),
            Spacer(1, 12),
            screenshot_frame,
            Spacer(1, 10),
            callout(
                "Next action",
                "Select <b>Manage reservation</b>. This opens the controls needed to start a host-side change request.",
                styles,
            ),
            Spacer(1, 7),
            Paragraph(
                "Screenshot data has been redacted for privacy. Airbnb interface labels can change.",
                styles["source"],
            ),
        ]
    )

    step_2_screenshot = Image(
        str(STEP_2_SCREENSHOT),
        width=5.25 * inch,
        height=5.25 * inch,
    )
    step_2_frame = Table([[step_2_screenshot]], colWidths=[5.45 * inch])
    step_2_frame.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            PageBreak(),
            Paragraph("STEP 2", styles["eyebrow"]),
            Paragraph("Choose Change reservation", styles["walkthrough_title"]),
            Paragraph(
                "After selecting <b>Manage reservation</b>, choose <b>Change reservation</b> from the menu. Do not use Cancel reservation or Send or request money for a date or guest-count alteration.",
                styles["walkthrough_body"],
            ),
            Spacer(1, 12),
            step_2_frame,
            Spacer(1, 10),
            callout(
                "Next action",
                "Select <b>Change reservation</b> to open the form where the dates and accommodation cost can be reviewed.",
                styles,
            ),
            Spacer(1, 7),
            Paragraph(
                "Guest name and phone number have been redacted for privacy. Airbnb interface labels can change.",
                styles["source"],
            ),
        ]
    )

    step_3_screenshot = Image(
        str(STEP_3_SCREENSHOT),
        width=5.55 * inch,
        height=5.55 * inch * (1225 / 1284),
    )
    step_3_frame = Table([[step_3_screenshot]], colWidths=[5.75 * inch])
    step_3_frame.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            PageBreak(),
            Paragraph("STEP 3", styles["eyebrow"]),
            Paragraph("Change the reservation dates", styles["walkthrough_title"]),
            Paragraph(
                "Select the guest's requested check-in and checkout dates. Confirm the dates are available and review any guest-count change before continuing.",
                styles["walkthrough_body"],
            ),
            Spacer(1, 12),
            step_3_frame,
            Spacer(1, 10),
            callout(
                "Next action",
                "Review <b>Guest charges</b>. Airbnb may recalculate the full stay after a date change, so verify the accommodation cost before sending the request.",
                styles,
            ),
            Spacer(1, 7),
            Paragraph(
                "Guest, listing, guest-count, and pricing details have been redacted for privacy. Airbnb interface labels can change.",
                styles["source"],
            ),
        ]
    )

    step_4_screenshot = Image(
        str(STEP_4_SCREENSHOT),
        width=6.35 * inch,
        height=6.35 * inch * (1092 / 1441),
    )
    step_4_frame = Table([[step_4_screenshot]], colWidths=[6.55 * inch])
    step_4_frame.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            PageBreak(),
            Paragraph("STEP 4", styles["eyebrow"]),
            Paragraph("Select the new dates", styles["walkthrough_title"]),
            Paragraph(
                "Choose the revised check-in and checkout dates requested by the guest. Review both date fields, then select <b>Save</b> to return to the alteration form.",
                styles["walkthrough_body"],
            ),
            Spacer(1, 12),
            step_4_frame,
            Spacer(1, 10),
            callout(
                "Before selecting Save",
                "Confirm the new range matches the guest's request and that every added night is available. Saving the dates does not mean the alteration is ready to send - the accommodation cost still needs to be verified.",
                styles,
            ),
            Spacer(1, 7),
            Paragraph(
                "Underlying listing content has been redacted for privacy. Airbnb interface labels can change.",
                styles["source"],
            ),
        ]
    )

    step_5_screenshot = AnnotatedScreenshot(
        STEP_5_SCREENSHOT,
        source_width=1417,
        source_height=1110,
        width=6.85 * inch,
        highlights=[(1054, 285, 334, 58, "1")],
    )
    step_5_frame = Table([[step_5_screenshot]], colWidths=[7.05 * inch])
    step_5_frame.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            PageBreak(),
            Paragraph("STEP 5", styles["eyebrow"]),
            Paragraph("Review the alteration pricing", styles["walkthrough_title"]),
            Paragraph(
                "In <b>Host payout details</b>, select the <b>Price difference</b> row to expand the pricing breakdown before changing the accommodation cost.",
                styles["walkthrough_body"],
            ),
            Spacer(1, 10),
            step_5_frame,
            Spacer(1, 9),
            callout(
                "1 - Understand the expanded pricing breakdown",
                "<b>Price adjustment:</b> the gross change in the accommodation charge - this is not the guest's complete total including Airbnb fees and taxes.<br/><b>Service fee adjustment:</b> the change in Airbnb's host service fee, deducted from the gross price adjustment.<br/><b>New payout:</b> the host's revised total payout after the alteration.<br/><b>Guest total, including fees and taxes:</b> the revised amount the guest pays.",
                styles,
            ),
            Spacer(1, 6),
            Paragraph(
                "Guest, listing, guest-count, and reservation-specific dollar amounts have been redacted for privacy. Airbnb interface labels can change.",
                styles["source"],
            ),
        ]
    )

    step_6_screenshot = AnnotatedScreenshot(
        STEP_6_SCREENSHOT,
        source_width=2052,
        source_height=766,
        width=6.75 * inch,
        highlights=[(918, 232, 582, 184, "2")],
    )
    step_6_frame = Table([[step_6_screenshot]], colWidths=[6.95 * inch])
    step_6_frame.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.8, LINE),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )
    story.extend(
        [
            PageBreak(),
            Paragraph("STEP 6", styles["eyebrow"]),
            Paragraph("Update the accommodation cost", styles["walkthrough_title"]),
            Paragraph(
                "Enter the <b>full revised accommodation cost</b> in the highlighted field. Do not enter only the incremental price of the added nights.",
                styles["walkthrough_body"],
            ),
            Spacer(1, 12),
            step_6_frame,
            Spacer(1, 10),
            callout(
                "2 - Check the alteration math",
                "<b>Full revised accommodation cost = original accommodation cost + approved price of added nights.</b><br/>For shortened stays, subtract the approved refund instead. The resulting <b>Price adjustment</b> should equal that gross accommodation-charge difference.",
                styles,
            ),
            Spacer(1, 10),
            callout(
                "Keep Airbnb fees separate",
                "Do not add Airbnb service fees or taxes to the accommodation-cost field; Airbnb calculates them separately. After editing the cost, reopen <b>Price difference</b> and confirm the price adjustment, service-fee adjustment, new payout, and guest total all make sense before sending.",
                styles,
            ),
            Spacer(1, 7),
            Paragraph(
                "Reservation-specific dollar amounts have been redacted for privacy. Airbnb interface labels can change.",
                styles["source"],
            ),
        ]
    )

    doc = GuideDocTemplate(str(OUTPUT))
    doc.build(story)
    shutil.copy2(OUTPUT, PUBLIC_COPY)

    if not OUTPUT.exists() or OUTPUT.stat().st_size < 10_000:
        raise RuntimeError("Generated PDF is missing or unexpectedly small")
    if PUBLIC_COPY.read_bytes() != OUTPUT.read_bytes():
        raise RuntimeError("Public resource copy does not match the generated PDF")

    print(OUTPUT)
    print(PUBLIC_COPY)


if __name__ == "__main__":
    build_pdf()
