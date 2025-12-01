require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { google } = require("googleapis");
const { Readable } = require("stream");

const app = express();
app.use(cors({
  origin: "*", // Tüm origin'lere izin ver (production'da spesifik domain'ler belirtebilirsin)
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

// Bellekte tutulan upload (diskte geçici dosya yok)
const upload = multer({ storage: multer.memoryStorage() });

// Google Drive client ayarı
let auth, drive;

try {
  const privateKey = process.env.GOOGLE_PRIVATE_KEY
    ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n")
    : null;

  if (!process.env.GOOGLE_CLIENT_EMAIL || !privateKey || !process.env.GOOGLE_DRIVE_FOLDER_ID) {
    console.error("Eksik environment variables!");
    console.error("GOOGLE_CLIENT_EMAIL:", process.env.GOOGLE_CLIENT_EMAIL ? "var" : "YOK");
    console.error("GOOGLE_PRIVATE_KEY:", process.env.GOOGLE_PRIVATE_KEY ? "var" : "YOK");
    console.error("GOOGLE_DRIVE_FOLDER_ID:", process.env.GOOGLE_DRIVE_FOLDER_ID ? "var" : "YOK");
  } else {
    console.log("Environment variables OK:");
    console.log("GOOGLE_CLIENT_EMAIL:", process.env.GOOGLE_CLIENT_EMAIL);
    console.log("GOOGLE_DRIVE_FOLDER_ID:", process.env.GOOGLE_DRIVE_FOLDER_ID);
  }

  auth = new google.auth.JWT(
    process.env.GOOGLE_CLIENT_EMAIL,
    null,
    privateKey,
    ["https://www.googleapis.com/auth/drive.file"]
  );

  drive = google.drive({ version: "v3", auth });
} catch (err) {
  console.error("Google Drive auth hatası:", err);
}

// Basit sağlık kontrolü (Render health check için)
app.get("/", (req, res) => {
  res.status(200).json({ status: "ok", message: "Character backend up" });
});

// Health check endpoint (Render için)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Resim upload endpoint'i
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Dosya bulunamadı" });
    }

    // Dosya meta bilgileri
    // ÖNEMLİ: GOOGLE_DRIVE_FOLDER_ID, senin kişisel Google Drive'ındaki bir klasörün ID'si olmalı
    // Service account bu klasöre "Düzenleyici" olarak paylaşılmış olmalı
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    
    if (!folderId) {
      console.error("GOOGLE_DRIVE_FOLDER_ID eksik!");
      return res.status(500).json({ error: "GOOGLE_DRIVE_FOLDER_ID environment variable eksik" });
    }

    console.log("Dosya yükleniyor, klasör ID:", folderId);
    console.log("Dosya adı:", req.file.originalname);
    console.log("Dosya boyutu:", req.file.size, "bytes");

    const fileMetadata = {
      name: req.file.originalname,
      parents: [folderId],
    };

    // Buffer'ı stream'e çevir (Google Drive API stream bekliyor)
    const bufferStream = new Readable();
    bufferStream.push(req.file.buffer);
    bufferStream.push(null); // Stream'i sonlandır

    const media = {
      mimeType: req.file.mimetype,
      body: bufferStream,
    };

    // Drive'a yükle
    const file = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: "id, name",
    });

    const fileId = file.data.id;

    // Herkese açık okuma izni ver
    await drive.permissions.create({
      fileId,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });

    // Direkt resim URL'si (uc?export=view trükü)
    const viewUrl = `https://drive.google.com/uc?export=view&id=${fileId}`;

    res.json({
      id: fileId,
      name: file.data.name,
      url: viewUrl,
    });
  } catch (err) {
    console.error("Upload hatası:", err);
    console.error("Hata detayı:", err.message);
    console.error("Stack:", err.stack);
    res.status(500).json({ 
      error: "Upload sırasında hata oluştu",
      message: err.message,
      details: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});