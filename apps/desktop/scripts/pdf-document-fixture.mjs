// Adapted from DeepSeek c291e796, MIT. See apps/desktop/LICENSE.deepseek.
/** Two-page PDF with vector rectangles and optional standard-font or CMap text. */

/** @returns complete PDF bytes; optional unembedded fonts exercise bundled resource loading. */
export function pdfFixture(withFont = false, withCMap = false) {
  const streams = ['0.9 0.1 0.1 rg 10 10 100 80 re f', '0.1 0.1 0.9 rg 10 10 100 80 re f']
  if (withCMap) streams[0] += '\n0 0 0 rg BT /F1 18 Tf 15 65 Td <65E5672C> Tj ET'
  else if (withFont) streams[0] += '\n0 0 0 rg BT /F1 18 Tf 15 65 Td (ABC) Tj ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 100] /Resources << ${withFont || withCMap ? '/Font << /F1 7 0 R >>' : ''} >> /Contents 4 0 R >>`,
    `<< /Length ${streams[0].length} >>\nstream\n${streams[0]}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 100] /Resources << >> /Contents 6 0 R >>',
    `<< /Length ${streams[1].length} >>\nstream\n${streams[1]}\nendstream`,
  ]
  if (withCMap) objects.push(
    '<< /Type /Font /Subtype /Type0 /BaseFont /HeiseiMin-W3 /Encoding /UniJIS-UCS2-H /DescendantFonts [8 0 R] >>',
    '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HeiseiMin-W3 /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 2 >> /FontDescriptor 9 0 R /DW 1000 >>',
    '<< /Type /FontDescriptor /FontName /HeiseiMin-W3 /Flags 6 /FontBBox [-123 -257 1001 910] /ItalicAngle 0 /Ascent 723 /Descent -241 /CapHeight 709 /StemV 69 >>',
  )
  else if (withFont) objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>')
  let text = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(text.length)
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = text.length
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new TextEncoder().encode(text)
}

/** A long PDF with full-page alternating colors for lazy rendering and navigation tests. */
export function pdfLongFixture(count = 24) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${Array.from({length:count},(_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${count} >>`,
  ];
  for (let i=0;i<count;i++) {
    const stream = `${i%2?'0.1 0.1 0.9':'0.9 0.1 0.1'} rg 0 0 600 800 re f`;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents ${4+i*2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let text='%PDF-1.4\n';const offsets=[0];
  objects.forEach((object,index)=>{offsets.push(text.length);text+=`${index+1} 0 obj\n${object}\nendobj\n`});
  const xref=text.length;
  text+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}
