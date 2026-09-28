// exif.mjs — reads what the bot bounty needs out of a JPEG: size, camera,
// when it was taken, and where (GPS). No dependency; a Worker has no sharp.

const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

/** { width, height, make, model, taken, offset, lat, lon, orientation } or
 *  { error } when the bytes are not a JPEG. Fields the file lacks are null. */
export function readJpeg(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return { error: 'not a JPEG' }
  const out = { width: null, height: null, make: null, model: null, taken: null, offset: null, lat: null, lon: null, orientation: null }
  let i = 2
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) { i++; continue }
    const mk = b[i + 1]
    if (mk === 0xff) { i++; continue }
    if (mk === 0xd9 || mk === 0xda) break                       // end, or start of scan
    if (mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7)) { i += 2; continue }
    const len = (b[i + 2] << 8) | b[i + 3]
    const seg = i + 4
    if (mk === 0xe1 && b[seg] === 0x45 && b[seg + 1] === 0x78 && b[seg + 2] === 0x69 && b[seg + 3] === 0x66) {
      try { Object.assign(out, tiff(b.subarray(seg + 6, i + 2 + len))) } catch { /* a broken block reads as no EXIF */ }
    }
    if ((mk >= 0xc0 && mk <= 0xcf) && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) {
      out.height = (b[seg + 1] << 8) | b[seg + 2]
      out.width = (b[seg + 3] << 8) | b[seg + 4]
    }
    i += 2 + len
  }
  if (out.orientation >= 5 && out.width) [out.width, out.height] = [out.height, out.width]
  return out
}

function tiff(t) {
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength)
  const le = t[0] === 0x49
  const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le)
  const val = (o) => {
    const type = u16(o + 2), n = u32(o + 4), size = (TYPE_SIZE[type] || 1) * n
    const at = size <= 4 ? o + 8 : u32(o + 8)
    if (type === 2) return new TextDecoder().decode(t.subarray(at, at + n)).replace(/\0.*$/s, '').trim()
    if (type === 3) return n === 1 ? u16(at) : Array.from({ length: n }, (_, k) => u16(at + 2 * k))
    if (type === 4) return n === 1 ? u32(at) : Array.from({ length: n }, (_, k) => u32(at + 4 * k))
    if (type === 5) return Array.from({ length: n }, (_, k) => { const d = u32(at + 8 * k + 4); return d ? u32(at + 8 * k) / d : 0 })
    return null
  }
  const ifd = (o) => {
    const tags = {}
    if (!o || o + 2 > t.length) return tags
    const n = u16(o)
    for (let k = 0; k < n; k++) {
      const e = o + 2 + 12 * k
      if (e + 12 > t.length) break
      try { tags[u16(e)] = val(e) } catch { /* skip a tag that points outside */ }
    }
    return tags
  }
  const i0 = ifd(u32(4))
  const ex = ifd(i0[0x8769])
  const gps = ifd(i0[0x8825])
  const deg = (v, ref) => Array.isArray(v) && v.length === 3 ? +((v[0] + v[1] / 60 + v[2] / 3600) * (/^[SW]/.test(ref || '') ? -1 : 1)).toFixed(6) : null
  const lat = deg(gps[2], gps[1]), lon = deg(gps[4], gps[3])
  const when = ex[0x9003] || i0[0x0132] || null
  return {
    make: i0[0x010f] || null, model: i0[0x0110] || null, orientation: i0[0x0112] || null,
    taken: when && /^\d{4}:\d\d:\d\d \d\d:\d\d:\d\d/.test(when) ? when.slice(0, 10).replace(/:/g, '-') + 'T' + when.slice(11, 19) : null,
    offset: ex[0x9011] || null,
    lat: lat === 0 && lon === 0 ? null : lat, lon: lat === 0 && lon === 0 ? null : lon,
  }
}
