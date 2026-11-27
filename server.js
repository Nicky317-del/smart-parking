
const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");
const { MongoClient } = require("mongodb");
const path = require("path");

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let mysqlConnection;
let mongoClient;
let mongoCollection;


// ==========================================
// CONNECT DATABASES
// ==========================================

async function connectDatabases() {
    try {
        // MYSQL CONNECTION
        mysqlConnection = mysql.createPool({
            host: process.env.MYSQL_HOST,
            user: process.env.MYSQL_USER,
            password: process.env.MYSQL_PASSWORD,
            database: process.env.MYSQL_DATABASE,
            waitForConnections: true,
            connectionLimit: 10
        });

        await mysqlConnection.query("SELECT 1");

        console.log("MySQL connected successfully!");

        // MONGODB CONNECTION
        mongoClient = new MongoClient(process.env.MONGO_URI);

        await mongoClient.connect();

        const mongoDB = mongoClient.db("smartpark_nosql");

        mongoCollection = mongoDB.collection("parking_sensor_logs");

        const sensorCount = await mongoCollection.countDocuments();

        console.log("MongoDB connected successfully!");
        console.log("Sensor logs:", sensorCount);


        // ==========================================
        // DASHBOARD
        // ==========================================

        app.get("/api/dashboard", async (req, res) => {
            try {
                const [total] = await mysqlConnection.query(
                    "SELECT COUNT(*) AS total FROM parking_slots"
                );

                const [available] = await mysqlConnection.query(
                    "SELECT COUNT(*) AS available FROM parking_slots WHERE slot_status = 'Available'"
                );

                const [occupied] = await mysqlConnection.query(
                    "SELECT COUNT(*) AS occupied FROM parking_slots WHERE slot_status = 'Occupied'"
                );

                const [reservations] = await mysqlConnection.query(
                    "SELECT COUNT(*) AS reservations FROM reservations"
                );

                res.json({
                    totalSlots: total[0].total,
                    availableSlots: available[0].available,
                    occupiedSlots: occupied[0].occupied,
                    totalReservations: reservations[0].reservations
                });

            } catch (error) {
                console.error("Dashboard error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // ==========================================
        // USERS
        // ==========================================

        // GET ALL USERS

        app.get("/api/users", async (req, res) => {
            try {
                const [users] = await mysqlConnection.query(`
                    SELECT user_id, full_name, email, phone
                    FROM users
                    ORDER BY user_id DESC
                `);

                res.json(users);

            } catch (error) {
                console.error("Load users error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // ADD NEW USER

        app.post("/api/users", async (req, res) => {
            try {
                const { full_name, email, phone } = req.body;

                if (!full_name || !email || !phone) {
                    return res.status(400).json({
                        error: "Please enter full name, email and phone."
                    });
                }

                const cleanName = String(full_name).trim();
                const cleanEmail = String(email).trim().toLowerCase();
                const cleanPhone = String(phone).trim();

                const [existing] = await mysqlConnection.query(
                    "SELECT user_id FROM users WHERE email = ?",
                    [cleanEmail]
                );

                if (existing.length > 0) {
                    return res.status(409).json({
                        error: "This email is already registered."
                    });
                }

                // No password hashing.
                // Empty value stored in password_hash.

                const [result] = await mysqlConnection.query(
                    `INSERT INTO users
                    (full_name, email, phone, password_hash)
                    VALUES (?, ?, ?, '')`,
                    [cleanName, cleanEmail, cleanPhone]
                );

                res.status(201).json({
                    message: "User added successfully.",
                    user_id: result.insertId,
                    full_name: cleanName,
                    email: cleanEmail,
                    phone: cleanPhone
                });

            } catch (error) {
                console.error("Add user error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // ==========================================
        // PARKING SLOTS
        // ==========================================

        app.get("/api/slots", async (req, res) => {
            try {
                const [rows] = await mysqlConnection.query(`
                    SELECT
                        ps.slot_id,
                        ps.zone_id,
                        ps.slot_number,
                        ps.slot_type,
                        ps.slot_status,
                        ps.hourly_rate,
                        ps.assigned_vehicle_id,
                        v.registration_number,
                        v.vehicle_type,
                        v.brand,
                        v.model,
                        v.color
                    FROM parking_slots ps
                    LEFT JOIN vehicles v
                        ON ps.assigned_vehicle_id = v.vehicle_id
                    ORDER BY ps.slot_id
                `);

                res.json(rows);

            } catch (error) {
                console.error("Load slots error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // ==========================================
        // MANUAL VEHICLE ASSIGNMENT
        // ==========================================

        app.post("/api/slots/:id/assign", async (req, res) => {
            let connection;

            try {
                const slotId = Number(req.params.id);
                const vehicleId = Number(req.body.vehicle_id);

                if (
                    !Number.isInteger(slotId) || slotId <= 0 ||
                    !Number.isInteger(vehicleId) || vehicleId <= 0
                ) {
                    return res.status(400).json({
                        error: "Invalid slot or vehicle ID."
                    });
                }

                connection = await mysqlConnection.getConnection();

                await connection.beginTransaction();

                const [slots] = await connection.query(
                    `SELECT slot_id, slot_type, slot_status,
                            assigned_vehicle_id
                     FROM parking_slots
                     WHERE slot_id = ?
                     FOR UPDATE`,
                    [slotId]
                );

                if (!slots.length) {
                    await connection.rollback();

                    return res.status(404).json({
                        error: "Parking slot not found."
                    });
                }

                const slot = slots[0];

                if (
                    slot.slot_status === "Maintenance" ||
                    slot.slot_status === "Reserved"
                ) {
                    await connection.rollback();

                    return res.status(400).json({
                        error: "This slot is not available for manual assignment."
                    });
                }

                if (slot.assigned_vehicle_id) {
                    await connection.rollback();

                    return res.status(400).json({
                        error: "This slot already has an assigned vehicle."
                    });
                }

                const [vehicles] = await connection.query(
                    `SELECT vehicle_id, vehicle_type
                     FROM vehicles
                     WHERE vehicle_id = ?`,
                    [vehicleId]
                );

                if (!vehicles.length) {
                    await connection.rollback();

                    return res.status(404).json({
                        error: "Vehicle not found."
                    });
                }

                const slotType = String(
                    slot.slot_type || ""
                ).toLowerCase();

                const vehicleType = String(
                    vehicles[0].vehicle_type || ""
                ).toLowerCase();

                const compatible =
                    slotType === "" ||
                    slotType === "general" ||
                    slotType === vehicleType ||
                    (slotType === "bike" && vehicleType === "scooter");

                if (!compatible) {
                    await connection.rollback();

                    return res.status(400).json({
                        error: "Vehicle type does not match this parking slot."
                    });
                }

                const [alreadyAssigned] = await connection.query(
                    `SELECT slot_id
                     FROM parking_slots
                     WHERE assigned_vehicle_id = ?`,
                    [vehicleId]
                );

                if (alreadyAssigned.length) {
                    await connection.rollback();

                    return res.status(400).json({
                        error: "This vehicle is already assigned to another slot."
                    });
                }

                await connection.query(
                    `UPDATE parking_slots
                     SET assigned_vehicle_id = ?,
                         slot_status = 'Occupied'
                     WHERE slot_id = ?`,
                    [vehicleId, slotId]
                );

                await connection.commit();

                res.json({
                    message: "Vehicle assigned successfully."
                });

            } catch (error) {
                if (connection) {
                    await connection.rollback();
                }

                console.error("Assignment error:", error);

                res.status(500).json({ error: error.message });

            } finally {
                if (connection) {
                    connection.release();
                }
            }
        });


        // REMOVE VEHICLE ASSIGNMENT

        app.delete("/api/slots/:id/assign", async (req, res) => {
            try {
                const slotId = Number(req.params.id);

                if (!Number.isInteger(slotId) || slotId <= 0) {
                    return res.status(400).json({
                        error: "Invalid parking slot ID."
                    });
                }

                const [result] = await mysqlConnection.query(
                    `UPDATE parking_slots
                     SET assigned_vehicle_id = NULL,
                         slot_status = 'Available'
                     WHERE slot_id = ?`,
                    [slotId]
                );

                if (!result.affectedRows) {
                    return res.status(404).json({
                        error: "Parking slot not found."
                    });
                }

                res.json({
                    message: "Vehicle assignment removed successfully."
                });

            } catch (error) {
                console.error("Remove assignment error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // ==========================================
        // VEHICLES
        // ==========================================

        // GET ALL VEHICLES

        app.get("/api/vehicles", async (req, res) => {
            try {
                const [rows] = await mysqlConnection.query(`
                    SELECT
                        vehicle_id,
                        user_id,
                        registration_number,
                        vehicle_type,
                        brand,
                        model,
                        color,
                        created_at
                    FROM vehicles
                    ORDER BY vehicle_id DESC
                `);

                res.json(rows);

            } catch (error) {
                console.error("Load vehicles error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // ADD VEHICLE

        app.post("/api/vehicles", async (req, res) => {
            try {
                const {
                    user_id,
                    registration_number,
                    vehicle_type,
                    brand,
                    model,
                    color
                } = req.body;

                const userId = Number(user_id);

                if (
                    !Number.isInteger(userId) || userId <= 0 ||
                    !registration_number || !vehicle_type
                ) {
                    return res.status(400).json({
                        error: "Please select a user and enter vehicle details."
                    });
                }

                const [users] = await mysqlConnection.query(
                    "SELECT user_id FROM users WHERE user_id = ?",
                    [userId]
                );

                if (!users.length) {
                    return res.status(400).json({
                        error: "User ID does not exist. Please select a registered user."
                    });
                }

                const registration = String(
                    registration_number
                ).trim().toUpperCase();

                const [existing] = await mysqlConnection.query(
                    `SELECT vehicle_id
                     FROM vehicles
                     WHERE registration_number = ?`,
                    [registration]
                );

                if (existing.length) {
                    return res.status(409).json({
                        error: "This vehicle registration number already exists."
                    });
                }

                const [result] = await mysqlConnection.query(
                    `INSERT INTO vehicles
                    (user_id, registration_number, vehicle_type,
                     brand, model, color)
                    VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        userId,
                        registration,
                        vehicle_type,
                        brand || null,
                        model || null,
                        color || null
                    ]
                );

                res.status(201).json({
                    message: "Vehicle registered successfully.",
                    vehicle_id: result.insertId
                });

            } catch (error) {
                console.error("Add vehicle error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // UPDATE VEHICLE

        app.put("/api/vehicles/:id", async (req, res) => {
            try {
                const vehicleId = Number(req.params.id);

                const {
                    user_id,
                    registration_number,
                    vehicle_type,
                    brand,
                    model,
                    color
                } = req.body;

                const userId = Number(user_id);

                if (
                    !Number.isInteger(vehicleId) || vehicleId <= 0 ||
                    !Number.isInteger(userId) || userId <= 0 ||
                    !registration_number || !vehicle_type
                ) {
                    return res.status(400).json({
                        error: "Invalid user or vehicle details."
                    });
                }

                const [users] = await mysqlConnection.query(
                    "SELECT user_id FROM users WHERE user_id = ?",
                    [userId]
                );

                if (!users.length) {
                    return res.status(400).json({
                        error: "Selected user does not exist."
                    });
                }

                const registration = String(
                    registration_number
                ).trim().toUpperCase();

                const [duplicate] = await mysqlConnection.query(
                    `SELECT vehicle_id
                     FROM vehicles
                     WHERE registration_number = ?
                     AND vehicle_id != ?`,
                    [registration, vehicleId]
                );

                if (duplicate.length) {
                    return res.status(409).json({
                        error: "This registration number belongs to another vehicle."
                    });
                }

                const [result] = await mysqlConnection.query(
                    `UPDATE vehicles
                     SET user_id = ?,
                         registration_number = ?,
                         vehicle_type = ?,
                         brand = ?,
                         model = ?,
                         color = ?
                     WHERE vehicle_id = ?`,
                    [
                        userId,
                        registration,
                        vehicle_type,
                        brand || null,
                        model || null,
                        color || null,
                        vehicleId
                    ]
                );

                if (!result.affectedRows) {
                    return res.status(404).json({
                        error: "Vehicle not found."
                    });
                }

                res.json({
                    message: "Vehicle updated successfully."
                });

            } catch (error) {
                console.error("Update vehicle error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // DELETE VEHICLE

        app.delete("/api/vehicles/:id", async (req, res) => {
            try {
                const vehicleId = Number(req.params.id);

                const [result] = await mysqlConnection.query(
                    "DELETE FROM vehicles WHERE vehicle_id = ?",
                    [vehicleId]
                );

                if (!result.affectedRows) {
                    return res.status(404).json({
                        error: "Vehicle not found."
                    });
                }

                res.json({
                    message: "Vehicle deleted successfully."
                });

            } catch (error) {
                console.error("Delete vehicle error:", error);

                res.status(500).json({
                    error: "Unable to delete this vehicle. It may be linked to another record."
                });
            }
        });


        // ==========================================
        // PAYMENTS
        // ==========================================

        app.get("/api/payments", async (req, res) => {
            try {
                const [rows] = await mysqlConnection.query(`
                    SELECT *
                    FROM payments
                    ORDER BY payment_id DESC
                `);

                res.json(rows);

            } catch (error) {
                console.error("Load payments error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // ==========================================
        // RESERVATIONS
        // ==========================================

        app.get("/api/reservations", async (req, res) => {
            try {
                const [rows] = await mysqlConnection.query(`
                    SELECT *
                    FROM reservations
                    ORDER BY reservation_id DESC
                    LIMIT 5
                `);

                res.json(rows);

            } catch (error) {
                console.error("Load reservations error:", error);
                res.status(500).json({ error: error.message });
            }
        });


        // ==========================================
        // START SERVER
        // ==========================================

        app.listen(3000, () => {
            console.log("Both databases are working together!");
            console.log("Server running at http://localhost:3000");
        });

    } catch (error) {
        console.error("Database connection error:", error);
    }
}


// ==========================================
// START APPLICATION
// ==========================================

connectDatabases();
