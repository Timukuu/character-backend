require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const axios = require("axios");
const FormData = require("form-data");

const app = express();
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

// Bellekte tutulan upload (diskte geçici dosya yok)
const upload = multer({ storage: multer.memoryStorage() });

// Basit sağlık kontrolü (Render health check için)
app.get("/", (req, res) => {
  res.status(200).json({ status: "ok", message: "Character backend up" });
});

// Health check endpoint (Render için)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Resim upload endpoint'i - Imgur kullanıyor
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Dosya bulunamadı" });
    }

    console.log("Dosya yükleniyor, Imgur'a gönderiliyor");
    console.log("Dosya adı:", req.file.originalname);
    console.log("Dosya boyutu:", req.file.size, "bytes");
    console.log("MIME type:", req.file.mimetype);

    // Imgur API'ye Base64 olarak yükle (daha güvenilir)
    // Buffer'ı Base64'e çevir
    const base64Image = req.file.buffer.toString('base64');
    
    // Imgur anonymous upload endpoint (Base64 ile)
    const imgurResponse = await axios.post(
      "https://api.imgur.com/3/image",
      {
        image: base64Image,
        type: "base64"
      },
      {
        headers: {
          'Content-Type': 'application/json',
          // Anonymous upload için Authorization header gerekmez
          // Ama rate limit çok düşük (1250 upload/gün)
          // Daha fazla için: https://api.imgur.com/oauth2/addclient adresinden client ID al
        }
      }
    );

    if (!imgurResponse.data || !imgurResponse.data.data || !imgurResponse.data.data.link) {
      throw new Error("Imgur yanıtında link bulunamadı");
    }

    const imageUrl = imgurResponse.data.data.link;

    console.log("Upload başarılı, URL:", imageUrl);

    res.json({
      id: imgurResponse.data.data.id,
      name: req.file.originalname,
      url: imageUrl,
    });
  } catch (err) {
    console.error("Upload hatası:", err);
    console.error("Hata detayı:", err.message);
    if (err.response) {
      console.error("Imgur yanıtı:", err.response.data);
    }
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
