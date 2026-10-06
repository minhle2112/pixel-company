"""Vẽ icon pixel của app Pixel Company (tự vẽ, không dùng hình LimeZu): màn hình agent mỉm cười trên ô vuông màu hổ phách.

Chạy: python desktop/icon/make-icon.py  ->  icon.png (256), icon.ico (16-256), icon-16.png, icon-32.png, preview.png
Cần Pillow.
"""
from pathlib import Path
from PIL import Image

HERE = Path(__file__).parent

PAL = {
    '.': (0, 0, 0, 0),
    'K': (16, 14, 24, 255),     # viền tối
    'A': (242, 181, 68, 255),   # hổ phách
    'a': (201, 141, 39, 255),   # hổ phách tối (bóng)
    'L': (255, 222, 140, 255),  # hổ phách sáng (ánh)
    'M': (42, 33, 53, 255),     # khung màn hình
    'm': (70, 60, 94, 255),     # khung sáng
    'S': (18, 48, 43, 255),     # màn hình
    's': (26, 66, 58, 255),     # dòng quét
    'G': (111, 208, 140, 255),  # mặt xanh phát sáng
    'g': (62, 140, 92, 255),    # má / viền mặt
    'R': (239, 107, 107, 255),  # đèn đỏ
    'T': (198, 110, 70, 255),   # chậu đất nung
}

# 32 x 32
ART32 = """
................................
.....KKKKKKKKKKKKKKKKKKKKKK.....
...KKLLLLLLLLLLLLLLLLLLLLLLKK...
..KLLAAAAAAAAAAAAAAAAAAAAAAAaK..
..KLAAAAAAAAAAAAAAAAAAAAAAAAaK..
.KLAAAAAAAAAAAAAAAAAAAAAAAAAAaK.
.KLAAAAKKKKKKKKKKKKKKKKKKKAAAaK.
.KLAAAKmmmmmmmmmmmmmmmmmmmKAAaK.
.KLAAAKmMMMMMMMMMMMMMMMMMMKAAaK.
.KLAAAKmMSSSSSSSSSSSSSSSSMKAAaK.
.KLAAAKmMSsssssssssssssssMKAAaK.
.KLAAAKmMSSSSSSSSSSSSSSSSMKAAaK.
.KLAAAKmMSSSGGSSSSSSGGSSSMKAAaK.
.KLAAAKmMSssGGssssssGGsssMKAAaK.
.KLAAAKmMSSSGGSSSSSSGGSSSMKAAaK.
.KLAAAKmMSSSSSSSSSSSSSSSSMKAAaK.
.KLAAAKmMSsssGssssssGssssMKAAaK.
.KLAAAKmMSSSSSGGGGGGSSSSSMKAAaK.
.KLAAAKmMSSSSSSSSSSSSSSSSMKAAaK.
.KLAAAKmMSsssssssssssssssMKAAaK.
.KLAAAKmMMMMMMMMMMMMMMMMRMKAAaK.
.KLAAKKKKKKKKKKKKKKKKKKKKKKAAaK.
.KLAKGGgKAAAAKMMMMMKAAAAAAAAAaK.
.KLKGGGggKAAAKmMMMMKAAAAAAAAAaK.
.KLAKKKKKAKKKKmMMMMKKKKAAAAAAaK.
.KLAKTTTKAKmmmmmmmmmmmKAAAAAAaK.
.KLAAKKKAAKKKKKKKKKKKKKAAAAAAaK.
..KAAAAAAAAAAAAAAAAAAAAAAAAaaK..
..KaAAAAAAAAAAAAAAAAAAAAAAaaaK..
...KKaaaaaaaaaaaaaaaaaaaaaaKK...
.....KKKKKKKKKKKKKKKKKKKKKK.....
................................
"""

# 24 x 24: thanh taskbar và (nhân đôi) lối tắt Desktop 48 px
ART24 = """
....KKKKKKKKKKKKKKKK....
..KKLLLLLLLLLLLLLLLLKK..
.KLLAAAAAAAAAAAAAAAAaaK.
.KLAAAAAAAAAAAAAAAAAAaK.
KLAAKKKKKKKKKKKKKKKKAAaK
KLAAKmmmmmmmmmmmmmmKAAaK
KLAAKmMSSSSSSSSSSMMKAAaK
KLAAKmMssssssssssMMKAAaK
KLAAKmMSSGSSSSGSSMMKAAaK
KLAAKmMSSGSSSSGSSMMKAAaK
KLAAKmMSSSSSSSSSSMMKAAaK
KLAAKmMssssssssssMMKAAaK
KLAAKmMSSGSSSSGSSMMKAAaK
KLAAKmMSSSGGGGSSSMMKAAaK
KLAAKmMSSSSSSSSSSMMKAAaK
KLAAKmMssssssssssMMKAAaK
KLAAKmMMMMMMMMMMRMMKAAaK
KLAAKKKKKKKKKKKKKKKKAAaK
KLAGGgAAAAKMMKAAAAAAAAaK
KLAKTKAKKKKKKKKKKAAAAAaK
.KLAKAAKmmmmmmmmKAAAAaK.
.KaAAAAKKKKKKKKKKAAAaaK.
..KKaaaaaaaaaaaaaaaaKK..
....KKKKKKKKKKKKKKKK....
"""

# 16 x 16: bản rút gọn cho cỡ nhỏ nhất (danh sách file, khay hệ thống)
ART16 = """
..KKKKKKKKKKKK..
.KLLLLLLLLLLLLK.
KLAAAAAAAAAAAAaK
KLAKKKKKKKKKKAaK
KLAKMMMMMMMMKAaK
KLAKMSSSSSSMKAaK
KLAKMSGSSGSMKAaK
KLAKMSSSSSSMKAaK
KLAKMGSSSSGMKAaK
KLAKMSGGGGSMKAaK
KLAKMMMMMMRMKAaK
KLAKKKKKKKKKKAaK
KLAAAAKMMKAAAAaK
KLAAAKKKKKKAAAaK
.KaaaaaaaaaaaaK.
..KKKKKKKKKKKK..
"""


def grid(art: str, n: int) -> Image.Image:
    rows = [r for r in art.strip('\n').split('\n')]
    assert len(rows) == n, (n, len(rows))
    im = Image.new('RGBA', (n, n))
    for y, row in enumerate(rows):
        assert len(row) == n, (n, y, len(row), row)
        for x, ch in enumerate(row):
            im.putpixel((x, y), PAL[ch])
    return im


def up(im: Image.Image, k: int) -> Image.Image:
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def main():
    a32 = grid(ART32, 32)
    a24 = grid(ART24, 24)
    a16 = grid(ART16, 16)
    big = up(a32, 8)
    big.save(HERE / 'icon.png')
    up(a32, 1).save(HERE / 'icon-32.png')
    a16.save(HERE / 'icon-16.png')
    sizes = {16: a16, 24: a24, 32: a32, 48: up(a24, 2), 64: up(a32, 2), 128: up(a32, 4), 256: big}
    # Pillow ghi .ico từ ảnh lớn nhất; truyền từng cỡ qua append_images để giữ đúng bản vẽ tay ở cỡ nhỏ
    big.save(HERE / 'icon.ico', format='ICO', sizes=[(s, s) for s in sizes],
             append_images=[sizes[s] for s in sizes if s != 256])
    # Ảnh xem trước cho người duyệt: các cỡ cạnh nhau trên nền sáng và tối
    sheet = Image.new('RGBA', (256 + 128 + 64 + 48 + 32 + 24 + 16 + 80, 2 * 266), (245, 245, 245, 255))
    dark = Image.new('RGBA', (sheet.width, 266), (32, 32, 40, 255))
    sheet.paste(dark, (0, 266))
    for row in (0, 266):
        x = 5
        for s in (256, 128, 64, 48, 32, 24, 16):
            im = sizes[s]
            sheet.alpha_composite(im, (x, row + 5))
            x += s + 10
    sheet.save(HERE / 'preview.png')


if __name__ == '__main__':
    main()
