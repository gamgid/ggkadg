import struct
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/icon-512.png"
BACKGROUND = (36, 61, 49)
TARGETS = {
    ROOT / "public/apple-touch-icon-v2.png": 180,
    ROOT / "public/pwa-icon-192-v2.png": 192,
    ROOT / "public/pwa-icon-512-v2.png": 512,
}


def paeth(a, b, c):
    estimate = a + b - c
    distances = (abs(estimate - a), abs(estimate - b), abs(estimate - c))
    return (a, b, c)[distances.index(min(distances))]


def read_rgba_png(path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("Source is not a PNG")

    position = 8
    compressed = []
    width = height = None
    while position < len(data):
        length = struct.unpack(">I", data[position : position + 4])[0]
        kind = data[position + 4 : position + 8]
        payload = data[position + 8 : position + 8 + length]
        position += 12 + length
        if kind == b"IHDR":
            width, height, depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", payload)
            if (depth, color_type, interlace) != (8, 6, 0):
                raise ValueError("Expected a non-interlaced 8-bit RGBA PNG")
        elif kind == b"IDAT":
            compressed.append(payload)

    raw = zlib.decompress(b"".join(compressed))
    stride = width * 4
    rows = []
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        row = bytearray(raw[offset : offset + stride])
        offset += stride
        previous = rows[-1] if rows else bytearray(stride)
        for index in range(stride):
            left = row[index - 4] if index >= 4 else 0
            above = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                row[index] = (row[index] + left) & 255
            elif filter_type == 2:
                row[index] = (row[index] + above) & 255
            elif filter_type == 3:
                row[index] = (row[index] + (left + above) // 2) & 255
            elif filter_type == 4:
                row[index] = (row[index] + paeth(left, above, upper_left)) & 255
            elif filter_type != 0:
                raise ValueError(f"Unsupported PNG filter: {filter_type}")
        rows.append(row)
    return width, height, rows


def flatten(rows):
    flattened = []
    for row in rows:
        output = bytearray()
        for index in range(0, len(row), 4):
            red, green, blue, alpha = row[index : index + 4]
            inverse = 255 - alpha
            output.extend(
                (
                    (red * alpha + BACKGROUND[0] * inverse + 127) // 255,
                    (green * alpha + BACKGROUND[1] * inverse + 127) // 255,
                    (blue * alpha + BACKGROUND[2] * inverse + 127) // 255,
                    255,
                )
            )
        flattened.append(bytes(output))
    return flattened


def resize_bilinear(source_width, source_height, source_rows, target_size):
    output_rows = []
    for target_y in range(target_size):
        source_y = (target_y + 0.5) * source_height / target_size - 0.5
        y0 = max(0, min(source_height - 1, int(source_y)))
        y1 = min(source_height - 1, y0 + 1)
        fy = max(0.0, source_y - y0)
        output = bytearray()
        for target_x in range(target_size):
            source_x = (target_x + 0.5) * source_width / target_size - 0.5
            x0 = max(0, min(source_width - 1, int(source_x)))
            x1 = min(source_width - 1, x0 + 1)
            fx = max(0.0, source_x - x0)
            for channel in range(4):
                top = source_rows[y0][x0 * 4 + channel] * (1 - fx) + source_rows[y0][x1 * 4 + channel] * fx
                bottom = source_rows[y1][x0 * 4 + channel] * (1 - fx) + source_rows[y1][x1 * 4 + channel] * fx
                output.append(round(top * (1 - fy) + bottom * fy))
        output_rows.append(bytes(output))
    return output_rows


def chunk(kind, payload):
    checksum = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", checksum)


def write_png(path, size, rows):
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    pixels = zlib.compress(b"".join(b"\0" + row for row in rows), 9)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", pixels)
        + chunk(b"IEND", b"")
    )


source_width, source_height, source_rows = read_rgba_png(SOURCE)
source_rows = flatten(source_rows)
for target, size in TARGETS.items():
    rows = source_rows if size == source_width == source_height else resize_bilinear(source_width, source_height, source_rows, size)
    write_png(target, size, rows)
    print(f"Created {target.relative_to(ROOT)} ({size}x{size})")
