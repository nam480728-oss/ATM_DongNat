// Bộ gõ Telex tiếng Việt tối giản (đủ cho nhập tên).
// Chuỗi "raw" là các phím đã gõ; hiển thị = telex(raw).
const TONES = { s: 1, f: 2, r: 3, x: 4, j: 5 };
const TONE_MAP = {
  a: 'aáàảãạ', ă: 'ăắằẳẵặ', â: 'âấầẩẫậ', e: 'eéèẻẽẹ', ê: 'êếềểễệ', i: 'iíìỉĩị',
  o: 'oóòỏõọ', ô: 'ôốồổỗộ', ơ: 'ơớờởỡợ', u: 'uúùủũụ', ư: 'ưứừửữự', y: 'yýỳỷỹỵ',
};
const VOWELS = 'aăâeêioôơuưy';
const isVowel = (c) => !!c && VOWELS.includes(c.toLowerCase());
const caseLike = (ch, ref) => (ref && ref !== ref.toLowerCase() ? ch.toUpperCase() : ch);

/** Vị trí cụm nguyên âm cuối cùng trong mảng ký tự: [start, end) */
function lastVowelRun(chars) {
  let end = chars.length;
  while (end > 0 && !isVowel(chars[end - 1])) end--;
  let start = end;
  while (start > 0 && isVowel(chars[start - 1])) start--;
  return [start, end];
}

function placeTone(chars, tone) {
  if (!tone) return chars;
  let [s, e] = lastVowelRun(chars);
  if (s === e) return chars;
  const low = chars.map((c) => c.toLowerCase());
  // "qu", "gi" + nguyên âm: u / i thuộc phụ âm đầu
  if (e - s > 1 && ((low[s] === 'u' && low[s - 1] === 'q') || (low[s] === 'i' && low[s - 1] === 'g'))) s++;
  const cluster = low.slice(s, e).join('');
  let pos;
  const marked = [...'âăêôơ'].map((v) => cluster.indexOf(v)).filter((i) => i >= 0);
  if (cluster.includes('ươ')) pos = s + cluster.indexOf('ươ') + 1;
  else if (marked.length) pos = s + Math.min(...marked);
  else if (cluster.includes('ư')) pos = s + cluster.indexOf('ư');
  else if (e - s === 1) pos = s;
  else if (e < chars.length) pos = e - 1;                 // có phụ âm cuối -> nguyên âm cuối cụm
  else if (['oa', 'oe', 'uy', 'uê'].includes(cluster)) pos = s + 1;
  else if (e - s === 3) pos = s + 1;
  else pos = s;
  const base = low[pos];
  const row = TONE_MAP[base];
  if (!row) return chars;
  const out = chars.slice();
  out[pos] = caseLike(row[tone], chars[pos]);
  return out;
}

export function telexWord(raw) {
  const out = [];
  let tone = 0;
  for (const ch of raw) {
    const lower = ch.toLowerCase();
    const hasVowel = out.some(isVowel);
    if (lower in TONES && hasVowel) {
      if (tone === TONES[lower]) { tone = 0; out.push(ch); } else tone = TONES[lower];
      continue;
    }
    if (lower === 'z' && hasVowel && tone) { tone = 0; continue; }
    const [s, e] = lastVowelRun(out);
    if ('aeo'.includes(lower) && e > s) {
      const idx = out.slice(s, e).map((c) => c.toLowerCase()).lastIndexOf(lower);
      if (idx >= 0) { out[s + idx] = caseLike({ a: 'â', e: 'ê', o: 'ô' }[lower], out[s + idx]); continue; }
    }
    if (lower === 'd' && out.length && out[out.length - 1].toLowerCase() === 'd') {
      out[out.length - 1] = caseLike('đ', out[out.length - 1]); continue;
    }
    if (lower === 'w') {
      if (e > s) {
        const cl = out.slice(s, e).map((c) => c.toLowerCase()).join('');
        const uo = cl.indexOf('uo');
        if (uo >= 0) { out[s + uo] = caseLike('ư', out[s + uo]); out[s + uo + 1] = caseLike('ơ', out[s + uo + 1]); continue; }
        for (let i = e - 1; i >= s; i--) {
          const m = { a: 'ă', o: 'ơ', u: 'ư' }[out[i].toLowerCase()];
          if (m) { out[i] = caseLike(m, out[i]); break; }
        }
        if (cl !== out.slice(s, e).map((c) => c.toLowerCase()).join('')) continue;
      }
      out.push(caseLike('ư', ch)); continue;
    }
    out.push(ch);
  }
  return placeTone(out, tone).join('');
}

/** Chuyển cả chuỗi (nhiều từ) và viết hoa chữ cái đầu mỗi từ (dùng cho tên). */
export function telex(raw, { capitalize = true } = {}) {
  return raw.split(' ').map((w) => {
    const v = telexWord(w);
    return capitalize && v ? v[0].toUpperCase() + v.slice(1) : v;
  }).join(' ');
}
