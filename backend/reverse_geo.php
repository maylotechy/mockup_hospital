<?php
$origin = $_SERVER['HTTP_ORIGIN'] ?? '*';
header("Access-Control-Allow-Origin: {$origin}");
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Allow-Headers: Content-Type, X-Requested-With, Authorization');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Content-Type: application/json');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(200);
    exit;
}

$lat = $_GET['lat'] ?? null;
$lng = $_GET['lng'] ?? $_GET['lon'] ?? null;

if ($lat === null || $lng === null) {
    echo json_encode(['success' => false, 'message' => 'Missing coordinates']);
    exit;
}

$latFloat = floatval($lat);
$lngFloat = floatval($lng);

// Opt-in via ?format=admin3: return "Barangay, Municipality, Province/District" built from
// Nominatim's structured address fields, instead of the default street-first address string.
// Highly urbanized cities (e.g. Davao City) have no province, so city_district/region are
// used as the third tier's fallback in that case.
$wantAdmin3 = ($_GET['format'] ?? '') === 'admin3';

function buildAdmin3Address(array $addr): ?string {
    $tier1 = $addr['village'] ?? $addr['suburb'] ?? $addr['neighbourhood'] ?? $addr['quarter'] ?? $addr['hamlet'] ?? null;
    $tier2 = $addr['city'] ?? $addr['town'] ?? $addr['municipality'] ?? $addr['county'] ?? null;
    $tier3 = $addr['state'] ?? $addr['province'] ?? $addr['city_district'] ?? $addr['state_district'] ?? $addr['region'] ?? null;

    $parts = array_filter([$tier1, $tier2, $tier3], fn($v) => $v !== null && $v !== '');
    if (count($parts) < 2) {
        return null; // not enough structure to be useful — caller falls back to the default format
    }
    return implode(', ', $parts);
}

// Known fallback coordinates for Mindanao region
function getKnownLocationFallback($lat, $lng) {
    if (abs($lat - 7.0620) < 0.02 && abs($lng - 125.6050) < 0.02) {
        return "Gumamela Street, Purok 60, SIR 1, 76-A Bucana, Davao City";
    }
    if (abs($lat - 7.0998) < 0.02 && abs($lng - 125.6195) < 0.02) {
        return "J.P. Laurel Avenue, Bajada, Davao City, Davao del Sur";
    }
    if (abs($lat - 6.6402) < 0.02 && abs($lng - 124.7384) < 0.02) {
        return "Tacurong City, Sultan Kudarat, Soccsksargen";
    }
    if (abs($lat - 7.1907) < 0.02 && abs($lng - 125.4553) < 0.02) {
        return "Calinan District, Davao City, Davao del Sur";
    }
    return null;
}

// Provider 1: OpenStreetMap Nominatim
$urlNominatim = "https://nominatim.openstreetmap.org/reverse?format=json&lat={$latFloat}&lon={$lngFloat}&addressdetails=1";
$ch = curl_init($urlNominatim);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_USERAGENT, 'MockHospitalHIS/1.0 (UP Mindanao Research; dev@upmin.edu.ph)');
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, false);
curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 2);
curl_setopt($ch, CURLOPT_TIMEOUT, 3);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

if ($httpCode >= 200 && $httpCode < 300 && !empty($response)) {
    $data = json_decode($response, true);
    if ($data && !empty($data['display_name'])) {
        if ($wantAdmin3 && !empty($data['address'])) {
            $admin3Address = buildAdmin3Address($data['address']);
            if ($admin3Address) {
                echo json_encode([
                    'success' => true,
                    'address' => $admin3Address,
                    'full_display_name' => $data['display_name'],
                    'provider' => 'nominatim'
                ]);
                exit;
            }
        }

        $parts = array_map('trim', explode(',', $data['display_name']));
        $formattedAddress = implode(', ', array_slice($parts, 0, 4));

        echo json_encode([
            'success' => true,
            'address' => $formattedAddress,
            'full_display_name' => $data['display_name'],
            'provider' => 'nominatim'
        ]);
        exit;
    }
}

// Provider 2: BigDataCloud Free Reverse Geocode API
$urlBDC = "https://api.bigdatacloud.net/data/reverse-geocode-client?latitude={$latFloat}&longitude={$lngFloat}&localityLanguage=en";
$ch2 = curl_init($urlBDC);
curl_setopt($ch2, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch2, CURLOPT_SSL_VERIFYPEER, false);
curl_setopt($ch2, CURLOPT_SSL_VERIFYHOST, false);
curl_setopt($ch2, CURLOPT_CONNECTTIMEOUT, 2);
curl_setopt($ch2, CURLOPT_TIMEOUT, 3);

$res2 = curl_exec($ch2);
$httpCode2 = curl_getinfo($ch2, CURLINFO_HTTP_CODE);
curl_close($ch2);

if ($httpCode2 >= 200 && $httpCode2 < 300 && !empty($res2)) {
    $data2 = json_decode($res2, true);
    if ($data2) {
        $locality = $data2['locality'] ?? $data2['city'] ?? $data2['principalSubdivision'] ?? '';
        $subdiv = $data2['principalSubdivision'] ?? '';
        $country = $data2['countryName'] ?? '';

        $parts2 = array_filter([$locality, $subdiv, $country]);
        if (!empty($parts2)) {
            $formattedBDC = implode(', ', $parts2);
            echo json_encode([
                'success' => true,
                'address' => $formattedBDC,
                'provider' => 'bigdatacloud'
            ]);
            exit;
        }
    }
}

// Provider 3: Local Known Location Fallback
$knownAddr = getKnownLocationFallback($latFloat, $lngFloat);
if ($knownAddr) {
    echo json_encode([
        'success' => true,
        'address' => $knownAddr,
        'provider' => 'local_known'
    ]);
    exit;
}

echo json_encode([
    'success' => false,
    'address' => "Davao Region, Philippines ({$latFloat}, {$lngFloat})"
]);
