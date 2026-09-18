export interface ApiFunction {
  name: string;
  signature: string;
  doc: string;
}

// Parses ApiBase.combined_doc() output (capx/integrations/base_api.py):
//
//   name(signature) -> ret
//     Doc:
//       docstring lines…
//
// Anything that doesn't fit (e.g. a leading comment line) is skipped.
const HEADER = /^([A-Za-z_]\w*)(\(.*)$/;

export function parseApiDocs(docs: string): ApiFunction[] {
  const functions: ApiFunction[] = [];
  let current: ApiFunction | null = null;
  for (const line of docs.split("\n")) {
    const header = HEADER.exec(line);
    if (header) {
      current = { name: header[1], signature: header[1] + header[2], doc: "" };
      functions.push(current);
    } else if (current && line.startsWith("  ") && line.trim() !== "Doc:") {
      current.doc += (current.doc ? "\n" : "") + line.replace(/^ {4}/, "");
    }
  }
  return functions;
}
