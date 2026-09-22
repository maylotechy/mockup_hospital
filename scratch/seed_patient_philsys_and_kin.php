<?php
// One-off seed: give every patient a fake PhilSys ID and a next-of-kin contact,
// so Phase 2 (PhilSys identifier + Patient.contact) has real data to exercise
// end to end. Uses the same cartoon/Marvel character pool as
// scratch/reseed_patient_names.php for next-of-kin names, offset so nobody is
// listed as their own next of kin.

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
$relationships = ['Spouse', 'Parent', 'Sibling', 'Child', 'Guardian', 'Friend'];
$poolSize = count($characterNames);
$nokOffset = 7; // arbitrary shift so next-of-kin never matches the patient's own name

$patients = $pdo->query('SELECT id FROM patients ORDER BY id ASC')->fetchAll(PDO::FETCH_ASSOC);

$updatePhilsys = $pdo->prepare('UPDATE patients SET philsys_id = :philsys_id WHERE id = :id');
$deleteExistingContact = $pdo->prepare('DELETE FROM patient_contacts WHERE patient_id = :id');
$insertContact = $pdo->prepare('
    INSERT INTO patient_contacts (patient_id, name, relationship, phone)
    VALUES (:patient_id, :name, :relationship, :phone)
');

$count = 0;
foreach ($patients as $i => $row) {
    $id = (int)$row['id'];

    // Deterministic-but-varied 16-digit PhilSys-style PSN, grouped 4-4-4-4.
    $digits = str_pad((string)($id * 7919 % 100000000), 8, '0', STR_PAD_LEFT) . str_pad((string)($id * 104729 % 10000), 4, '0', STR_PAD_LEFT) . str_pad((string)($id % 10000), 4, '0', STR_PAD_LEFT);
    $digits = substr($digits, 0, 16);
    $philsysId = implode('-', str_split($digits, 4));
    $updatePhilsys->execute([':philsys_id' => $philsysId, ':id' => $id]);

    [$nokFirst, $nokLast] = $characterNames[($i + $nokOffset) % $poolSize];
    $relationship = $relationships[$i % count($relationships)];
    $phone = '09' . str_pad((string)((171000000 + $id * 37) % 1000000000), 9, '0', STR_PAD_LEFT);

    $deleteExistingContact->execute([':id' => $id]);
    $insertContact->execute([
        ':patient_id' => $id,
        ':name' => "$nokFirst $nokLast",
        ':relationship' => $relationship,
        ':phone' => $phone,
    ]);

    $count++;
}

echo "Seeded PhilSys ID + next-of-kin for {$count} patients.\n";
print_r($pdo->query('
    SELECT p.id, p.first_name, p.last_name, p.philsys_id, nok.name as nok_name, nok.relationship, nok.phone
    FROM patients p
    LEFT JOIN patient_contacts nok ON nok.patient_id = p.id
    ORDER BY p.id ASC
    LIMIT 5
')->fetchAll(PDO::FETCH_ASSOC));
