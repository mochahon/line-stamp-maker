/* Minimal ZIP writer (STORE method, no compression).
 * PNG files are already compressed, so storing them uncompressed keeps the
 * archive valid and nearly the same size. No external dependencies.
 * Works in browsers and in Node (for tests). */
(function (global) {
  'use strict';

  var CRC_TABLE = null;
  function crcTable() {
    if (CRC_TABLE) return CRC_TABLE;
    var table = new Int32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c;
    }
    CRC_TABLE = table;
    return table;
  }
  function crc32(bytes) {
    var table = crcTable();
    var crc = -1;
    for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
    return (crc ^ -1) >>> 0;
  }

  function dosDateTime(date) {
    var d = date || new Date();
    var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
    var day = (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
    return { time: time, date: day };
  }

  /**
   * files: [{ name: string, data: Uint8Array }]
   * returns Uint8Array of the whole archive.
   */
  function createZip(files, date) {
    var encoder = new TextEncoder();
    var chunks = [];
    var central = [];
    var offset = 0;
    var dt = dosDateTime(date);

    files.forEach(function (f) {
      var nameBytes = encoder.encode(f.name);
      var data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
      var crc = crc32(data);
      var local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);            // version needed
      local.setUint16(6, 0x0800, true);        // UTF-8 filename flag
      local.setUint16(8, 0, true);             // STORE
      local.setUint16(10, dt.time, true);
      local.setUint16(12, dt.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, nameBytes.length, true);
      local.setUint16(28, 0, true);
      chunks.push(new Uint8Array(local.buffer), nameBytes, data);

      var cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, 0, true);
      cen.setUint16(12, dt.time, true);
      cen.setUint16(14, dt.date, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, data.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, nameBytes.length, true);
      cen.setUint32(42, offset, true);
      central.push(new Uint8Array(cen.buffer), nameBytes);

      offset += 30 + nameBytes.length + data.length;
    });

    var centralSize = central.reduce(function (s, c) { return s + c.length; }, 0);
    var end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    chunks = chunks.concat(central, [new Uint8Array(end.buffer)]);

    var total = chunks.reduce(function (s, c) { return s + c.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    chunks.forEach(function (c) { out.set(c, pos); pos += c.length; });
    return out;
  }

  var api = { createZip: createZip, crc32: crc32 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.StampZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
