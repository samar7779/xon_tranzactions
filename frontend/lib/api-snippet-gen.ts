/**
 * 4 ta tilda HTTP request snippet generatori.
 * curl: shell, Node.js: fetch, PHP: cURL, Python: requests.
 */

export type SnippetLang = 'curl' | 'node' | 'php' | 'python';

export const SNIPPET_LANGS: { key: SnippetLang; label: string }[] = [
  { key: 'curl', label: 'cURL' },
  { key: 'node', label: 'Node.js' },
  { key: 'php', label: 'PHP' },
  { key: 'python', label: 'Python' },
];

interface SnippetArgs {
  method: string;
  url: string;        // to'liq URL
  keyId: string;
  secret: string;
}

export function genSnippet(lang: SnippetLang, args: SnippetArgs): string {
  const { method, url, keyId, secret } = args;
  switch (lang) {
    case 'curl':
      return `curl -X ${method} ${url} \\
  -H "X-API-Key: ${keyId}" \\
  -H "X-API-Secret: ${secret}"`;

    case 'node':
      return `const resp = await fetch("${url}", {
  method: "${method}",
  headers: {
    "X-API-Key": "${keyId}",
    "X-API-Secret": "${secret}",
  },
});
const data = await resp.json();
console.log(data);`;

    case 'php':
      return `<?php
$ch = curl_init("${url}");
curl_setopt($ch, CURLOPT_CUSTOMREQUEST, "${method}");
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  "X-API-Key: ${keyId}",
  "X-API-Secret: ${secret}",
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$response = curl_exec($ch);
curl_close($ch);
$data = json_decode($response, true);`;

    case 'python':
      return `import requests

resp = requests.${method.toLowerCase()}(
    "${url}",
    headers={
        "X-API-Key": "${keyId}",
        "X-API-Secret": "${secret}",
    },
)
data = resp.json()
print(data)`;
  }
}
