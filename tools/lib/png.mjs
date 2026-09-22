const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let n = 0; n < 8; n++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function parsePNG(bytes) {
  if (bytes.length < 20 || !bytes.subarray(0, 8).equals(SIGNATURE)) throw new Error('无效 PNG 签名。');
  let offset = 8; const chunks = []; let ended = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) throw new Error('PNG 数据块被截断。');
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw new Error('PNG 数据块长度越界。');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!/^[a-z]{4}$/i.test(type)) throw new Error('PNG 数据块类型无效。');
    const raw = bytes.subarray(offset, offset + length + 12);
    const payload = raw.subarray(8, 8 + length);
    if (crc32(raw.subarray(4, 8 + length)) !== raw.readUInt32BE(8 + length)) throw new Error(`PNG ${type} 校验失败。`);
    chunks.push({ type, data: payload, raw });
    offset += length + 12;
    if (type === 'IEND') { if (length !== 0 || offset !== bytes.length) throw new Error('PNG IEND 后存在无效数据。'); ended = true; break; }
  }
  if (!ended || chunks[0]?.type !== 'IHDR' || chunks[0].data.length !== 13 || !chunks.some(c => c.type === 'IDAT')) throw new Error('PNG 缺少完整图像数据。');
  return chunks;
}
export function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length); bytes.write(type, 4, 4, 'ascii'); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
function keyword(c) {
  if (c.type !== 'tEXt') return '';
  const separator = c.data.indexOf(0);
  return separator < 0 ? '' : c.data.toString('latin1', 0, separator).toLowerCase();
}
export function readCardPNG(bytes) {
  const chunks = parsePNG(bytes);
  const chosen = chunks.find(c => keyword(c) === 'ccv3') ?? chunks.find(c => keyword(c) === 'chara');
  if (!chosen) throw new Error('PNG 中没有角色卡数据（chara／ccv3）。');
  const encoded = chosen.data.subarray(chosen.data.indexOf(0) + 1).toString('ascii');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) throw new Error('PNG 角色卡 Base64 无效。');
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.toString('base64') !== encoded) throw new Error('PNG 角色卡 Base64 不规范或已损坏。');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  let card; try { card = JSON.parse(text); } catch { throw new Error('PNG 角色卡内容不是有效 JSON。'); }
  return { card, text, metadataType: keyword(chosen), chunks };
}
export function writeCardPNG(image, card) {
  const chunks = parsePNG(image).filter(c => !['chara', 'ccv3'].includes(keyword(c)));
  const key = card.spec === 'chara_card_v3' ? 'ccv3' : 'chara';
  const payload = Buffer.from(key + '\0' + Buffer.from(JSON.stringify(card)).toString('base64'), 'latin1');
  return Buffer.concat([SIGNATURE, ...chunks.slice(0, -1).map(c => c.raw), chunk('tEXt', payload), chunks.at(-1).raw]);
}
