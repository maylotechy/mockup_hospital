<?php
// One-off cleanup: replace seeded patient names (realistic-looking Filipino
// names) with clearly fictional cartoon/Marvel character names, so local test
// data is unmistakably fake -- same spirit as the DIWA-IRDSS-TEST-/DiWA-IRDSS Test-
// convention used for the FHIR Connectathon sandbox (see hackathon_tracker/).
// Also updates every place a patient's name is denormalized elsewhere:
// initiated_referrals.patient_name, patients.transferred_details_snapshot
// (JSON full_name field), and audit_logs.patient_name (matched by old name,
// since audit_logs has no patient_id column).

require_once __DIR__ . '/../backend/config.php';
$pdo = getDbConnection();

$characterNames = [
    ['Tony', 'Stark'], ['Steve', 'Rogers'], ['Natasha', 'Romanoff'], ['Bruce', 'Banner'],
    ['Peter', 'Parker'], ['Wanda', 'Maximoff'], ['Stephen', 'Strange'], ['Carol', 'Danvers'],
    ['Scott', 'Lang'], ['Clint', 'Barton'], ['Sam', 'Wilson'], ['Bucky', 'Barnes'],
    ['Peter', 'Quill'], ['Gamora', 'Zenwhoberi'], ['Groot', 'Flora'], ['Rocket', 'Raccoon'],
    ['Wade', 'Wilson'], ['Matt', 'Murdock'], ['Jessica', 'Jones'], ['Luke', 'Cage'],
    ['Danny', 'Rand'], ['Hope', 'VanDyne'], ['Pietro', 'Maximoff'], ['Vision', 'Android'],
    ['Homer', 'Simpson'], ['Marge', 'Simpson'], ['Bart', 'Simpson'], ['Lisa', 'Simpson'],
    ['Bugs', 'Bunny'], ['Daffy', 'Duck'], ['Mickey', 'Mouse'], ['Minnie', 'Mouse'],
    ['SpongeBob', 'SquarePants'], ['Patrick', 'Star'], ['Sandy', 'Cheeks'], ['Squidward', 'Tentacles'],
    ['Scooby', 'Doo'], ['Shaggy', 'Rogers'], ['Fred', 'Flintstone'], ['Wilma', 'Flintstone'],
    ['Timmy', 'Turner'], ['Dexter', 'Boygenius'], ['Johnny', 'Bravo'], ['Samurai', 'Jack'],
    ['Finn', 'Mertens'], ['Jake', 'Dog'], ['Popeye', 'Sailor'], ['Olive', 'Oyl'],
    ['Woody', 'Pride'], ['Buzz', 'Lightyear'],
];

$patients = $pdo->query('SELECT id, first_name, last_name, transferred_details_snapshot FROM patients ORDER BY id ASC')->fetchAll(PDO::FETCH_ASSOC);

$updatePatient = $pdo->prepare('UPDATE patients SET first_name = :fn, middle_name = NULL, last_name = :ln, suffix = NULL WHERE id = :id');
$updateReferral = $pdo->prepare('UPDATE initiated_referrals SET patient_name = :full_name WHERE patient_id = :id');
$updateSnapshot = $pdo->prepare('UPDATE patients SET transferred_details_snapshot = :snapshot WHERE id = :id');
$updateAuditLog = $pdo->prepare('UPDATE audit_logs SET patient_name = :new_name WHERE patient_name = :old_name');

$count = 0;
foreach ($patients as $i => $row) {
    $id = (int)$row['id'];
    $oldFullName = trim($row['first_name'] . ' ' . $row['last_name']);
    [$first, $last] = $characterNames[$i % count($characterNames)];
    $newFullName = "$first $last";

    $updatePatient->execute([':fn' => $first, ':ln' => $last, ':id' => $id]);
    $updateReferral->execute([':full_name' => $newFullName, ':id' => $id]);
    $updateAuditLog->execute([':new_name' => $newFullName, ':old_name' => $oldFullName]);

    if ($row['transferred_details_snapshot']) {
        $snapshot = json_decode($row['transferred_details_snapshot'], true);
        if (is_array($snapshot)) {
            $snapshot['full_name'] = $newFullName;
            $updateSnapshot->execute([':snapshot' => json_encode($snapshot), ':id' => $id]);
        }
    }
    $count++;
}

echo "Reseeded {$count} patient names with cartoon/Marvel characters.\n";
print_r($pdo->query('SELECT id, first_name, last_name FROM patients ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
