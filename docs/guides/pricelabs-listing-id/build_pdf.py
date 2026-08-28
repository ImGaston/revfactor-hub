from pathlib import Path
from typing import Iterable

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


ROOT = Path(__file__).resolve().parents[3]
GUIDE_DIR = Path(__file__).resolve().parent
SCREENSHOTS = GUIDE_DIR / "screenshots"
ASSETS = GUIDE_DIR / "assets"
OUTPUT = ROOT / "output" / "pdf" / "revfactor-pricelabs-listing-id-guide.pdf"

PAGE_W, PAGE_H = LETTER
MARGIN = 46

BONE = HexColor("#DDDAD3")
MOSS = HexColor("#5D6D59")
CEDAR = HexColor("#13342D")
WALNUT = HexColor("#76574C")
TOBACCO = HexColor("#3F261F")
ONYX = HexColor("#161910")
PAPER = HexColor("#F7F5F0")
SOFT_MOSS = HexColor("#E8ECE6")
SOFT_WALNUT = HexColor("#EEE7E3")

FONT_REGULAR = ASSETS / "fonts" / "CormorantGaramond-Regular.ttf"
FONT_SEMIBOLD = ASSETS / "fonts" / "CormorantGaramond-SemiBold.ttf"
MASTER_LOGO = ASSETS / "revfactor-master-logo-cedar.png"
SECONDARY_LOGO = ASSETS / "revfactor-secondary-logo-cedar.png"


def register_fonts() -> None:
    pdfmetrics.registerFont(TTFont("Cormorant", str(FONT_REGULAR)))
    pdfmetrics.registerFont(TTFont("Cormorant-Semibold", str(FONT_SEMIBOLD)))


def wrap_lines(text: str, font: str, size: float, max_width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if pdfmetrics.stringWidth(candidate, font, size) <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def draw_wrapped(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    font: str = "Helvetica",
    size: float = 10.5,
    leading: float = 15,
    color=ONYX,
) -> float:
    c.setFont(font, size)
    c.setFillColor(color)
    for line in wrap_lines(text, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y


def draw_numbered_item(
    c: canvas.Canvas,
    number: int,
    title: str,
    body: str,
    x: float,
    y: float,
    width: float,
    accent=WALNUT,
) -> float:
    c.setFillColor(accent)
    c.circle(x + 13, y - 2, 13, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 11)
    c.drawCentredString(x + 13, y - 6, str(number))
    c.setFillColor(CEDAR)
    c.setFont("Helvetica-Bold", 11)
    c.drawString(x + 36, y + 1, title)
    bottom = draw_wrapped(c, body, x + 36, y - 15, width - 36, size=9.4, leading=13, color=ONYX)
    return bottom - 8


def draw_image_card(
    c: canvas.Canvas,
    path: Path,
    x: float,
    y: float,
    width: float,
    height: float | None = None,
    pad: float = 8,
) -> tuple[float, float]:
    image = ImageReader(str(path))
    image_w, image_h = image.getSize()
    if height is None:
        height = width * image_h / image_w
    c.setFillColor(white)
    c.roundRect(x, y, width, height, 10, stroke=0, fill=1)
    c.setStrokeColor(BONE)
    c.setLineWidth(0.8)
    c.roundRect(x, y, width, height, 10, stroke=1, fill=0)
    available_w = width - 2 * pad
    available_h = height - 2 * pad
    scale = min(available_w / image_w, available_h / image_h)
    draw_w = image_w * scale
    draw_h = image_h * scale
    draw_x = x + (width - draw_w) / 2
    draw_y = y + (height - draw_h) / 2
    c.drawImage(image, draw_x, draw_y, draw_w, draw_h, mask="auto")
    return width, height


def draw_header(c: canvas.Canvas, section: str, page_number: int) -> None:
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(CEDAR)
    c.rect(0, PAGE_H - 8, PAGE_W, 8, stroke=0, fill=1)
    c.drawImage(ImageReader(str(SECONDARY_LOGO)), MARGIN, PAGE_H - 66, 102, 30, mask="auto")
    c.setFont("Helvetica-Bold", 8.2)
    c.setFillColor(MOSS)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 50, section.upper())
    c.setStrokeColor(BONE)
    c.setLineWidth(0.8)
    c.line(MARGIN, PAGE_H - 78, PAGE_W - MARGIN, PAGE_H - 78)
    c.setFont("Helvetica", 8)
    c.setFillColor(MOSS)
    c.drawString(MARGIN, 25, "revfactor.io")
    c.drawRightString(PAGE_W - MARGIN, 25, f"PAGE {page_number:02d}")


def draw_page_title(c: canvas.Canvas, title: str, subtitle: str | None = None) -> float:
    y = PAGE_H - 125
    c.setFont("Cormorant-Semibold", 28)
    c.setFillColor(CEDAR)
    c.drawString(MARGIN, y, title)
    y -= 23
    if subtitle:
        y = draw_wrapped(c, subtitle, MARGIN, y, PAGE_W - 2 * MARGIN, size=10.2, leading=14, color=ONYX)
    return y - 12


def draw_cover(c: canvas.Canvas) -> None:
    c.setFillColor(BONE)
    c.rect(0, 0, PAGE_W, PAGE_H, stroke=0, fill=1)
    c.setFillColor(CEDAR)
    c.rect(0, 0, 18, PAGE_H, stroke=0, fill=1)

    c.drawImage(ImageReader(str(MASTER_LOGO)), 58, 575, 250, 142, mask="auto")

    c.setFillColor(WALNUT)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(60, 535, "CLIENT GUIDE")
    c.setStrokeColor(WALNUT)
    c.setLineWidth(1)
    c.line(60, 525, 154, 525)

    c.setFillColor(CEDAR)
    c.setFont("Cormorant-Semibold", 39)
    c.drawString(60, 470, "how to find your")
    c.drawString(60, 426, "PriceLabs listing ID")

    draw_wrapped(
        c,
        "A quick, visual guide for sending RevFactor the correct property identifiers.",
        60,
        382,
        425,
        size=13,
        leading=19,
        color=ONYX,
    )

    c.setFillColor(SOFT_MOSS)
    c.roundRect(60, 255, 492, 74, 12, stroke=0, fill=1)
    c.setFillColor(CEDAR)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(82, 300, "WHAT YOU WILL SEND")
    c.setFont("Helvetica", 10.5)
    c.setFillColor(ONYX)
    c.drawString(82, 278, "Your listing name and the PriceLabs channel/listing ID shown with it.")

    c.setFillColor(CEDAR)
    c.rect(18, 0, PAGE_W - 18, 92, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(60, 55, "CLARITY  /  CONFIDENCE  /  CONTROL")
    c.setFont("Helvetica", 8)
    c.drawRightString(PAGE_W - 60, 55, "UPDATED AUGUST 2026")
    c.showPage()


def draw_open_manage_listings(c: canvas.Canvas) -> None:
    draw_header(c, "PriceLabs listing ID guide", 2)
    y = draw_page_title(
        c,
        "1. Open Manage Listings",
        "After signing in to PriceLabs, use the top navigation to reach the page where listing IDs are displayed.",
    )

    y = draw_numbered_item(
        c,
        1,
        "Open Dynamic Pricing",
        "Select Dynamic Pricing in the top navigation.",
        MARGIN,
        y,
        PAGE_W - 2 * MARGIN,
    )
    draw_image_card(c, SCREENSHOTS / "01-dynamic-pricing-menu.jpg", MARGIN, y - 83, PAGE_W - 2 * MARGIN, 72)

    panel_y = 275
    draw_image_card(c, SCREENSHOTS / "02-select-manage-listings.jpg", MARGIN, panel_y, 235, 232, pad=10)
    text_x = MARGIN + 260
    text_y = panel_y + 208
    text_y = draw_numbered_item(
        c,
        2,
        "Select Manage Listings",
        "Choose Manage Listings from the Dynamic Pricing dropdown.",
        text_x,
        text_y,
        PAGE_W - MARGIN - text_x,
    )
    c.setFillColor(SOFT_WALNUT)
    c.roundRect(text_x, panel_y + 68, PAGE_W - MARGIN - text_x, 82, 10, stroke=0, fill=1)
    c.setFillColor(TOBACCO)
    c.setFont("Helvetica-Bold", 9)
    c.drawString(text_x + 16, panel_y + 127, "SUCCESS CHECK")
    draw_wrapped(
        c,
        "The page heading should read Manage Listings.",
        text_x + 16,
        panel_y + 106,
        PAGE_W - MARGIN - text_x - 32,
        size=9.5,
        leading=13,
    )

    draw_image_card(c, SCREENSHOTS / "03-manage-listings-page.jpg", MARGIN, 100, PAGE_W - 2 * MARGIN, 92, pad=10)
    c.showPage()


def draw_locate_listing(c: canvas.Canvas) -> None:
    draw_header(c, "Locate your listing", 3)
    y = draw_page_title(
        c,
        "2. Locate your listing",
        "A listing can appear under Unmapped Listings or Mapped Listings. Search both before assuming it is missing.",
    )

    y = draw_numbered_item(
        c,
        1,
        "Search Unmapped Listings",
        "Enter the property name in the search box and look for the correct listing.",
        MARGIN,
        y,
        PAGE_W - 2 * MARGIN,
    )
    y = draw_numbered_item(
        c,
        2,
        "Then search Mapped Listings",
        "If the property does not appear, select Mapped Listings and search for the same name again.",
        MARGIN,
        y,
        PAGE_W - 2 * MARGIN,
    )

    draw_image_card(c, SCREENSHOTS / "08-locate-listing-tabs-annotated.png", MARGIN, 335, PAGE_W - 2 * MARGIN, 176, pad=8)

    c.setFillColor(CEDAR)
    c.roundRect(MARGIN, 138, PAGE_W - 2 * MARGIN, 145, 12, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN + 20, 253, "PREVIOUSLY MAPPED LISTINGS")
    draw_wrapped(
        c,
        "If you mapped the listing previously, its ID will be under Mapped Listings. Airbnb and Vrbo pairs may appear as PARENT and CHILD rows.",
        MARGIN + 20,
        226,
        PAGE_W - 2 * MARGIN - 40,
        size=10.4,
        leading=15,
        color=white,
    )
    c.setFillColor(BONE)
    c.setFont("Helvetica-Bold", 9.4)
    c.drawString(MARGIN + 20, 165, "Send the channel/listing ID from the first line of every relevant row.")
    c.showPage()


def draw_pms_connected(c: canvas.Canvas) -> None:
    draw_header(c, "PMS-connected listings", 4)
    y = draw_page_title(
        c,
        "3A. If you use a PMS",
        "Search for the property name. PriceLabs shows the channel and ID on the first line and the listing name on the second line.",
    )

    draw_image_card(c, SCREENSHOTS / "04-ashwood-listing-cell-annotated.png", MARGIN, 415, PAGE_W - 2 * MARGIN, 150, pad=8)

    c.setFillColor(SOFT_MOSS)
    c.roundRect(MARGIN, 238, PAGE_W - 2 * MARGIN, 132, 12, stroke=0, fill=1)
    c.setFillColor(CEDAR)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN + 18, 343, "READ THE LISTING NAME BOX")
    draw_numbered_item(c, 1, "Listing name", "The second line identifies the property.", MARGIN + 18, 316, 230, accent=MOSS)
    draw_numbered_item(c, 2, "Listing ID", "The first line shows the channel followed by its ID.", MARGIN + 270, 316, 245, accent=MOSS)

    c.setFillColor(CEDAR)
    c.roundRect(MARGIN, 126, PAGE_W - 2 * MARGIN, 76, 12, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN + 20, 176, "SEND TO REVFACTOR")
    c.setFont("Helvetica", 10)
    c.drawString(MARGIN + 20, 151, "The listing name plus the channel/listing ID shown on the first line.")
    c.showPage()


def draw_direct_channels(c: canvas.Canvas) -> None:
    draw_header(c, "Airbnb and Vrbo without a PMS", 5)
    y = draw_page_title(
        c,
        "3B. If you do not use a PMS",
        "When Airbnb and Vrbo connect directly to PriceLabs, the same property may appear as two channel-specific listings.",
    )

    draw_image_card(c, SCREENSHOTS / "05-airbnb-vrbo-listing-cells-annotated.png", MARGIN, 385, PAGE_W - 2 * MARGIN, 183, pad=8)

    c.setFillColor(SOFT_WALNUT)
    c.roundRect(MARGIN, 247, PAGE_W - 2 * MARGIN, 100, 12, stroke=0, fill=1)
    c.setFillColor(TOBACCO)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN + 18, 320, "SEND BOTH LISTING IDs")
    draw_wrapped(
        c,
        "Find the Airbnb ID on the first line of the Airbnb row and the Vrbo ID on the first line of the Vrbo row. The second lines help confirm that you selected the correct property.",
        MARGIN + 18,
        297,
        PAGE_W - 2 * MARGIN - 36,
        size=9.7,
        leading=14,
    )

    c.setFillColor(CEDAR)
    c.roundRect(MARGIN, 111, PAGE_W - 2 * MARGIN, 96, 12, stroke=0, fill=1)
    c.setFillColor(white)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(MARGIN + 18, 179, "FINAL CHECKLIST")
    checklist = [
        "Listing name",
        "Airbnb channel/listing ID",
        "Vrbo channel/listing ID, when applicable",
    ]
    y = 157
    for item in checklist:
        c.setFillColor(BONE)
        c.circle(MARGIN + 23, y + 2, 3, stroke=0, fill=1)
        c.setFillColor(white)
        c.setFont("Helvetica", 9.6)
        c.drawString(MARGIN + 34, y - 1, item)
        y -= 20
    c.showPage()


def main() -> None:
    register_fonts()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUTPUT), pagesize=LETTER, pageCompression=1)
    c.setTitle("How to Find Your PriceLabs Listing ID")
    c.setAuthor("RevFactor")
    c.setSubject("Client guide for locating PriceLabs listing IDs")
    c.setCreator("RevFactor")

    draw_cover(c)
    draw_open_manage_listings(c)
    draw_locate_listing(c)
    draw_pms_connected(c)
    draw_direct_channels(c)
    c.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
