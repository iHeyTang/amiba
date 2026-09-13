import { deflateSync } from 'node:zlib';
import { imageDocumentFixtures } from './image-document-fixtures.mjs';

// Self-generated 32x32 RGB swatch encoded with Pillow 11.3.0 JPEG2000.
const jpx = Buffer.from('AAAADGpQICANCocKAAAAFGZ0eXBqcDIgAAAAAGpwMiAAAAAtanAyaAAAABZpaGRyAAAAIAAAACAAAwcHAAAAAAAPY29scgEAAAAAABAAAAE2anAyY/9P/1EALwAAAAAAIAAAACAAAAAAAAAAAAAAACAAAAAgAAAAAAAAAAAAAwcBAQcBAQcBAf9SAAwAAAABAAUEBAAB/1wAE0BASEhQSEhQSEhQSEhQSEhQ/2QAJQABQ3JlYXRlZCBieSBPcGVuSlBFRyB2ZXJzaW9uIDIuNS4z/5AACgAAAAAArwAB/5PH1AQAD8+0CAXLx9QECW/PwAgFb8HzggAAH8/ACAK/x9oKAAFoXejHwPkBgAgVrMfaCgAIIHHox8faDgAX16F/1ezdwfOGABcsc4InD8faDgAXK59/1ezdx9oYACIaCaBfZdkkyxOgf8HzigAhbg0YvmQtZf9/x9oYACFuB6BfZdkkyxOgf8faCgA2nkGracHzhQA18j/jjMfaCgA18j+raf/Z', 'base64');

/** A binary-safe PDF containing an image XObject, optionally with a soft mask. */
export function pdfImageFixture(kind) {
  let data, filter, mask;
  if (kind === 'jpeg') {
    data = Buffer.from(imageDocumentFixtures.find(f => f.name === 'baseline').base64, 'base64');
    filter = 'DCTDecode';
  } else if (kind === 'jpx') {
    data = jpx;
    filter = 'JPXDecode';
  } else if (kind === 'soft-mask') {
    const pixels = Buffer.alloc(32*32*3);
    const alpha = Buffer.alloc(32*32);
    for (let y=0;y<32;y++) for (let x=0;x<32;x++) {
      pixels.set(x<16?[224,32,32]:[32,64,224],(y*32+x)*3);
      alpha[y*32+x]=x<16?128:255;
    }
    data=deflateSync(pixels);mask=deflateSync(alpha);filter='FlateDecode';
  } else throw new Error(`Unknown PDF image fixture: ${kind}`);
  const stream = (body, attributes='') => Buffer.concat([
    Buffer.from(`<< ${attributes} /Length ${body.length} >>\nstream\n`),body,Buffer.from('\nendstream'),
  ]);
  const paint = Buffer.from('0.12549 0.75294 0.25098 rg 0 0 128 128 re f\nq 96 0 0 96 16 16 cm /Im1 Do Q');
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 128 128] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>'),
    stream(paint),
    stream(data, `/Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} ${mask?'/SMask 6 0 R':''}`),
  ];
  if (mask) objects.push(stream(mask,'/Type /XObject /Subtype /Image /Width 32 /Height 32 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode'));
  const parts=[Buffer.from('%PDF-1.5\n')], offsets=[0];let size=parts[0].length;
  objects.forEach((object,index)=>{
    offsets.push(size);const part=Buffer.concat([Buffer.from(`${index+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);
    parts.push(part);size+=part.length;
  });
  parts.push(Buffer.from(`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`));
  return Buffer.concat(parts);
}
