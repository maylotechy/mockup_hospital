<?php
require_once __DIR__ . '/../backend/config.php';
$pdo = getDbConnection();
echo "--- HOSPITALS ---\n";
print_r($pdo->query("SELECT id, code, name, username, api_key FROM hospitals")->fetchAll(PDO::FETCH_ASSOC));
echo "--- PATIENTS ---\n";
print_r($pdo->query("SELECT id, hospital_id, first_name, last_name FROM patients")->fetchAll(PDO::FETCH_ASSOC));
