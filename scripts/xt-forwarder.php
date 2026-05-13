<?php
/**
 * Xon Tranzaksiyalar — bank API forwarder
 *
 * O'rnatish:
 *   1. cPanel File Manager → public_html → "+ Fayl" tugmasi
 *   2. Nomi: xt-forwarder.php
 *   3. Edit → bu kodni paste qiling → Save
 *
 * URL: https://xonapp.uz/xt-forwarder.php
 *
 * Test:
 *   curl https://xonapp.uz/xt-forwarder.php
 *   → {"ok":false,"error":"method_not_allowed"}  (POST kutadi)
 *
 *   curl -X POST https://xonapp.uz/xt-forwarder.php
 *   → {"ok":false,"error":"unauthorized"}  (secret kerak — TO'G'RI)
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SOZLAMALAR
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 32 belgili tasodifiy parol — Xon backend bilan bir xil bo'lsin
$SHARED_SECRET = 'xt_a8f3e2d1c9b7654321fedcba0987abcd';

// Faqat ushbu IP'lardan kirishga ruxsat
$ALLOWED_CLIENT_IPS = [
    '185.228.88.247',  // Xon Tranzaksiyalar server
    '127.0.0.1',       // local test
];

// Faqat ushbu bank domenlariga uzatish (xavfsizlik)
$ALLOWED_HOSTS = [
    'm.bank24.uz',
    'mb.bank24.uz',
    'mb.ipakyulibank.uz',
    'api.hayatbank.uz',
    'mb.hayot.uz',
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

header('Content-Type: application/json; charset=utf-8');
header('X-Forwarder: xt-v1');

// 1. Faqat POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'method_not_allowed', 'hint' => 'POST kerak']);
    exit;
}

// 2. Client IP
$clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
$clientIp = trim(explode(',', $clientIp)[0]);
if (!in_array($clientIp, $ALLOWED_CLIENT_IPS, true)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'ip_not_allowed', 'ip' => $clientIp]);
    exit;
}

// 3. Secret
$providedSecret = $_SERVER['HTTP_X_PROXY_SECRET'] ?? '';
if (!hash_equals($SHARED_SECRET, $providedSecret)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'error' => 'unauthorized']);
    exit;
}

// 4. Body parse
$raw = file_get_contents('php://input');
$payload = json_decode($raw, true);
if (!is_array($payload) || empty($payload['url'])) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'error' => 'bad_request', 'hint' => '{url, method, headers, body}']);
    exit;
}

$targetUrl = $payload['url'];
$method    = strtoupper($payload['method'] ?? 'POST');
$headers   = $payload['headers'] ?? [];
$body      = $payload['body'] ?? '';
$timeout   = min((int)($payload['timeout'] ?? 30), 60);

// 5. Host whitelist
$parsed = parse_url($targetUrl);
$host = strtolower($parsed['host'] ?? '');
if (!in_array($host, $ALLOWED_HOSTS, true)) {
    http_response_code(403);
    echo json_encode(['ok' => false, 'error' => 'host_not_allowed', 'host' => $host]);
    exit;
}

// 6. cURL → bank
$curlHeaders = [];
foreach ($headers as $k => $v) {
    $curlHeaders[] = "$k: $v";
}

$ch = curl_init($targetUrl);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $curlHeaders,
    CURLOPT_TIMEOUT        => $timeout,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
    CURLOPT_FOLLOWLOCATION => false,
]);

if (in_array($method, ['POST', 'PUT', 'PATCH'], true)) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
}

$bankBody = curl_exec($ch);
$bankStatus = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr = curl_error($ch);
$totalMs = round(curl_getinfo($ch, CURLINFO_TOTAL_TIME) * 1000);
curl_close($ch);

if ($curlErr) {
    http_response_code(502);
    echo json_encode([
        'ok' => false,
        'error' => 'curl_error',
        'message' => $curlErr,
        'host' => $host,
    ]);
    exit;
}

// 7. Bank javobini xuddi shunday qaytarish
http_response_code($bankStatus ?: 502);
header("X-Target-Host: $host");
header("X-Target-Time: {$totalMs}ms");
echo $bankBody;
