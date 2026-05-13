<?php
/**
 * Xon Tranzaksiyalar — Bank API forwarder (cPanel uchun)
 *
 * Bu fayl ahost'da PHP server'da turadi va Xon backend'idan kelgan
 * bank API so'rovlarini bank'ga uzatadi. Bank ahost IP'sini ko'radi.
 *
 * O'rnatish:
 *   1. cPanel File Manager → public_html ichiga shu faylni yuklang
 *   2. .htaccess'ga ruxsat berish kerak bo'lsa: "Options -MultiViews"
 *   3. Test: curl https://uz01.ahost.uz/bank-proxy.php  (401 qaytarishi kerak)
 *
 * Xon backend env'ga qo'shing:
 *   BANK_FORWARDER_URL=https://uz01.ahost.uz/bank-proxy.php
 *   BANK_FORWARDER_SECRET=<SHARED_SECRET>  (pastdagi qiymat bilan bir xil)
 */

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SOZLAMALAR — buni o'zgartiring!
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// 32 belgili tasodifiy parol — Xon backend bilan bir xil bo'lsin
$SHARED_SECRET = 'CHANGE_ME_TO_32_HEX_SECRET_abc123';

// Faqat shu IP'lardan kirishga ruxsat (Xon server IP)
$ALLOWED_CLIENT_IPS = [
    '185.228.88.247',
    '127.0.0.1', // local test
];

// Faqat shu bank domenlariga uzatish (xavfsizlik — boshqalarga uzatish mumkin emas)
$ALLOWED_HOSTS = [
    'm.bank24.uz',
    'mb.ipakyulibank.uz',
    'mb.hayot.uz',
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

header('Content-Type: application/json');
header('X-Proxy-Version: 1.0');

// 1. Client IP tekshirish
$clientIp = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? '';
$clientIp = trim(explode(',', $clientIp)[0]); // birinchi (asl) IP
if (!in_array($clientIp, $ALLOWED_CLIENT_IPS)) {
    http_response_code(403);
    die(json_encode(['error' => 'forbidden', 'message' => "IP $clientIp ruxsat etilmagan"]));
}

// 2. Secret tekshirish
$secret = $_SERVER['HTTP_X_PROXY_SECRET'] ?? '';
if (empty($secret) || !hash_equals($SHARED_SECRET, $secret)) {
    http_response_code(401);
    die(json_encode(['error' => 'unauthorized', 'message' => 'invalid secret']));
}

// 3. So'rov tanasini o'qish
$raw = file_get_contents('php://input');
$payload = json_decode($raw, true);
if (!$payload || !isset($payload['url'])) {
    http_response_code(400);
    die(json_encode(['error' => 'bad_request', 'message' => 'url required']));
}

$url = $payload['url'];
$method = strtoupper($payload['method'] ?? 'POST');
$headers = $payload['headers'] ?? [];
$body = $payload['body'] ?? '';
$timeout = min((int)($payload['timeout'] ?? 30), 60);

// 4. URL domenini tekshirish
$parsed = parse_url($url);
$host = $parsed['host'] ?? '';
if (!in_array($host, $ALLOWED_HOSTS)) {
    http_response_code(403);
    die(json_encode(['error' => 'host_not_allowed', 'message' => "Domain $host whitelist'da yo'q"]));
}

// 5. cURL orqali bank'ga so'rov yuborish
$ch = curl_init($url);
$curlHeaders = [];
foreach ($headers as $k => $v) {
    $curlHeaders[] = "$k: $v";
}

curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $curlHeaders,
    CURLOPT_TIMEOUT        => $timeout,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_FOLLOWLOCATION => false,
]);

if (in_array($method, ['POST', 'PUT', 'PATCH'])) {
    curl_setopt($ch, CURLOPT_POSTFIELDS, is_string($body) ? $body : json_encode($body));
}

$responseBody = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$err = curl_error($ch);
$total = curl_getinfo($ch, CURLINFO_TOTAL_TIME);
curl_close($ch);

if ($err) {
    http_response_code(502);
    die(json_encode([
        'error' => 'forwarder_error',
        'message' => $err,
        'targetHost' => $host,
    ]));
}

// 6. Bank javobini xuddi shunday qaytarish (status code + body)
http_response_code($status ?: 502);
header("X-Forwarder-Target: $host");
header("X-Forwarder-Time: " . round($total * 1000) . "ms");
echo $responseBody;
