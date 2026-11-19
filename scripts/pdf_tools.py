#!/usr/bin/env python3
"""Помощник для подготовки уроков из PDF-сканов учебника (pdf-book-splitter/output).

Зависимости: poppler-utils (pdfimages, pdftoppm), tesseract с языком rus, Pillow.

  python scripts/pdf_tools.py pages  <file.pdf> <out_dir> [--ocr]
      Страницы как JPG (p-000.jpg …). PDF в базе — сканы без текстового слоя,
      поэтому --ocr дополнительно создаёт p-000.txt (tesseract rus+eng).
      OCR — черновик: формулы, индексы и числа сверяйте по картинке страницы.

  python scripts/pdf_tools.py crop <spec.json>
      Вырезает рисунки. spec — список [страница.jpg, выход.jpg, x1, y1, x2, y2]
      в пикселях исходной страницы. Подпись «Рис. N…» в картинку не включайте —
      она идёт в поле caption.

  python scripts/pdf_tools.py sheet <out.jpg> <img1> [img2 …]
      Контактный лист вырезанных картинок с именами файлов — для визуальной проверки.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def pages(pdf: str, out_dir: str, ocr: bool) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    listing = subprocess.run(['pdfimages', '-list', pdf], capture_output=True, text=True).stdout.splitlines()[2:]
    n_pages = int(subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout.split('Pages:')[1].split()[0])
    if len(listing) == n_pages:
        # одна картинка на страницу — это скан, берём его без пересжатия
        subprocess.run(['pdfimages', '-j', pdf, str(out / 'p')], check=True)
    else:
        subprocess.run(['pdftoppm', '-jpeg', '-r', '150', pdf, str(out / 'p')], check=True)
        for i, f in enumerate(sorted(out.glob('p-*.jpg'))):
            f.rename(out / f'p-{i:03d}.jpg')
    files = sorted(out.glob('p-*.jpg'))
    for f in files:
        print(f, Image.open(f).size)
    if ocr:
        if not shutil.which('tesseract'):
            sys.exit('tesseract не найден')
        for f in files:
            subprocess.run(['tesseract', str(f), str(f.with_suffix('')), '-l', 'rus+eng', '--psm', '1'],
                           capture_output=True, check=True)
        print(f'OCR: {len(files)} стр. → *.txt')


def crop(spec_path: str) -> None:
    for src, dst, x1, y1, x2, y2 in json.loads(Path(spec_path).read_text(encoding='utf-8')):
        Path(dst).parent.mkdir(parents=True, exist_ok=True)
        im = Image.open(src).convert('RGB').crop((x1, y1, x2, y2))
        im.save(dst, quality=88)
        print(dst, im.size)


def sheet(out: str, files: list[str]) -> None:
    ims = [Image.open(f).convert('RGB') for f in files]
    w = max(i.width for i in ims)
    h = sum(i.height + 20 for i in ims)
    canvas = Image.new('RGB', (w, h), 'white')
    draw = ImageDraw.Draw(canvas)
    y = 0
    for f, im in zip(files, ims):
        draw.text((0, y), Path(f).name, fill='red')
        canvas.paste(im, (0, y + 12))
        y += im.height + 20
    canvas.save(out)
    print(out, canvas.size)


if __name__ == '__main__':
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'pages':
        pages(args[0], args[1], '--ocr' in args)
    elif cmd == 'crop':
        crop(args[0])
    elif cmd == 'sheet':
        sheet(args[0], args[1:])
    else:
        sys.exit(__doc__)
