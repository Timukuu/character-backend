require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { google } = require("googleapis");

const app = express();
app.use(cors());

// Bellekte tutulan upload (diskte geçici dosya yok)
const upload = multer({ storage: multer.memoryStorage() });

// Google Drive client ayarı
const auth = new google.auth.JWT(
  process.env.GOOGLE_CLIENT_EMAIL,
  null,
  process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  ["https://www.googleapis.com/auth/drive.file"]
);

const drive = google.drive({ version: "v3", auth });

// Basit sağlık kontrolü
app.get("/", (req, res) => {
  res.send("Character backend up");
});

// Resim upload endpoint'i
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Dosya bulunamadı" });
    }

    // Dosya meta bilgileri
    const fileMetadata = {
      name: req.file.originalname,
      parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
    };

    const media = {
      mimeType: req.file.mimetype,
      body: Buffer.from(req.file.buffer),
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
    res.status(500).json({ error: "Upload sırasında hata oluştu" });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});