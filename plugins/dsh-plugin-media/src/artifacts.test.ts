import { expect, it, vi } from "vitest";
import { artifactAddresses } from "./artifacts.js";
const signal = new AbortController().signal;
it("resolves fake-IP storage hosts to a verified public address without sending signed paths", async () => {
  const http = vi.fn().mockResolvedValue(
    Response.json({
      Status: 0,
      Answer: [
        { type: 5, data: "cdn.example" },
        { type: 1, data: "203.1.2.3" },
      ],
    }),
  );
  const dns = vi
    .fn()
    .mockResolvedValue([{ address: "198.18.2.117", family: 4 }]);
  expect(
    await artifactAddresses("storage.example", signal, dns as never, http),
  ).toEqual([{ address: "203.1.2.3", family: 4 }]);
  expect(http.mock.calls[0]?.[0]).toBe(
    "https://cloudflare-dns.com/dns-query?name=storage.example&type=A",
  );
});
it("never relaxes private-address rejection and never resolves literal fake IPs externally", async () => {
  const http = vi
    .fn()
    .mockResolvedValue(
      Response.json({ Status: 0, Answer: [{ type: 1, data: "127.0.0.1" }] }),
    );
  await expect(
    artifactAddresses(
      "storage.example",
      signal,
      vi
        .fn()
        .mockResolvedValue([{ address: "198.18.2.117", family: 4 }]) as never,
      http,
    ),
  ).rejects.toThrow("non-public");
  http.mockClear();
  await expect(
    artifactAddresses(
      "198.18.2.117",
      signal,
      vi
        .fn()
        .mockResolvedValue([{ address: "198.18.2.117", family: 4 }]) as never,
      http,
    ),
  ).rejects.toThrow("non-public");
  expect(http).not.toHaveBeenCalled();
  await expect(
    artifactAddresses(
      "private.example",
      signal,
      vi.fn().mockResolvedValue([{ address: "10.0.0.1", family: 4 }]) as never,
      http,
    ),
  ).rejects.toThrow("non-public");
  expect(http).not.toHaveBeenCalled();
});
it('persists JSON companion data and rejects HTML masquerading as a file',async()=>{
 const {detectMedia}=await import('./artifacts.js');
 expect(detectMedia(Buffer.from('{"layers":[]}'),'file')).toBe('application/json');
 expect(()=>detectMedia(Buffer.from('<script>alert(1)</script>'),'file')).toThrow();
});
it('matches Node autoSelectFamily lookup callback shapes while pinning the verified IP',async()=>{
 const {pinnedLookup}=await import('./artifacts.js');
 const pinned={address:'203.1.2.3',family:4}; const lookup=pinnedLookup(pinned);
 const all=vi.fn(),single=vi.fn();
 lookup('cdn.example',{all:true},all); expect(all).toHaveBeenCalledWith(null,[pinned]);
 lookup('cdn.example',{},single); expect(single).toHaveBeenCalledWith(null,pinned.address,4);
});
