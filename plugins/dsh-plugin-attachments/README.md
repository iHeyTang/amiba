# @amiba/dsh-plugin-attachments

Bounded attachment readers owned by DSH: `attachment_read_text` and `attachment_read_pdf`. Paths must remain under the configured Amiba attachment staging root; symlinks, empty files, oversized files, invalid UTF-8, and unsupported binary content are rejected.

- Injects: `tools`, `systemPrompt`, `amibaToolCatalog`
- Config: managed attachment `root`
- Native image parts continue through DSH prompt content; these tools cover text and PDF extraction.
