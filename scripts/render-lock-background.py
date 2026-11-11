#!/usr/bin/env python3
"""Regenerate the default swaylock prompt (requires Pillow + DejaVu Sans)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
root = Path(__file__).resolve().parent.parent
im = Image.new('RGB', (640, 480), '#050608')
draw = ImageDraw.Draw(im)
for text, y, size, color in [
    ('Southbag session locked', 28, 29, '#e8e6df'),
    ('Type your Southbag Identity password', 80, 20, '#b6bac3'),
    ('Press Enter to unlock', 366, 22, '#e8e6df'),
    ('Internet access is required to verify your password.', 410, 16, '#b6bac3'),
]:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', size)
    draw.text((320, y), text, fill=color, font=font, anchor='mt')
im.save(root / 'image/config/includes.chroot/usr/share/southbag-lock/prompt.png')
