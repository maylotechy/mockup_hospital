<?php
require_once __DIR__ . '/../backend/config.php';
$pdo = getDbConnection();
$pdo->exec("UPDATE patients SET hospital_id = 1 WHERE id IN (1, 2)");
$pdo->exec("UPDATE patients SET hospital_id = 2 WHERE id IN (3, 4)");
$pdo->exec("UPDATE patients SET hospital_id = 3 WHERE id IN (5, 6)");
echo "Patients hospital_id updated successfully!\n";
print_r($pdo->query("SELECT id, hospital_id, first_name, last_name FROM patients")->fetchAll(PDO::FETCH_ASSOC));
