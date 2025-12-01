require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const fs = require("fs").promises;
const path = require("path");

const app = express();
app.use(express.json()); // JSON body parser
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"]
}));

// Bellekte tutulan upload (diskte geçici dosya yok)
const upload = multer({ storage: multer.memoryStorage() });

// Cloudinary yapılandırması
// Not: Environment variables opsiyonel - eğer yoksa unsigned upload kullanılır
if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
  });
  console.log("Cloudinary configured with credentials");
} else {
  console.log("Cloudinary will use unsigned upload (no credentials needed)");
}

// Basit sağlık kontrolü (Render health check için)
app.get("/", (req, res) => {
  res.status(200).json({ status: "ok", message: "Character backend up" });
});

// Health check endpoint (Render için)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date().toISOString() });
});

// Proje verilerini tutmak için dosya yolu
const PROJECTS_FILE = path.join(__dirname, "data", "projects.json");
// Karakter verilerini tutmak için dosya yolu
const CHARACTERS_FILE = path.join(__dirname, "data", "characters.json");

// Proje verilerini yükle
async function loadProjects() {
  try {
    const data = await fs.readFile(PROJECTS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    // Dosya yoksa varsayılan projeleri oluştur
    const defaultProjects = [
      { id: "proje-1", name: "Örnek Proje 1" },
      { id: "proje-2", name: "Örnek Proje 2" }
    ];
    // Klasör yoksa oluştur
    await fs.mkdir(path.dirname(PROJECTS_FILE), { recursive: true });
    await fs.writeFile(PROJECTS_FILE, JSON.stringify(defaultProjects, null, 2));
    return defaultProjects;
  }
}

// Proje verilerini kaydet
async function saveProjects(projects) {
  await fs.mkdir(path.dirname(PROJECTS_FILE), { recursive: true });
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// ID oluştur
function generateProjectId() {
  return "proje-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function generateCharacterId() {
  return "char-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// Karakter verilerini yükle
async function loadCharacters() {
  try {
    const data = await fs.readFile(CHARACTERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    // Dosya yoksa boş obje döndür
    return {};
  }
}

// Karakter verilerini kaydet
async function saveCharacters(characters) {
  await fs.mkdir(path.dirname(CHARACTERS_FILE), { recursive: true });
  await fs.writeFile(CHARACTERS_FILE, JSON.stringify(characters, null, 2));
}

// Proje endpoint'leri
// Tüm projeleri getir
app.get("/api/projects", async (req, res) => {
  try {
    const projects = await loadProjects();
    res.json(projects);
  } catch (err) {
    console.error("Projeler yüklenirken hata:", err);
    res.status(500).json({ error: "Projeler yüklenemedi" });
  }
});

// Yeni proje oluştur
app.post("/api/projects", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Proje adı gerekli" });
    }

    const projects = await loadProjects();
    const newProject = {
      id: generateProjectId(),
      name: name.trim()
    };
    projects.push(newProject);
    await saveProjects(projects);

    res.json(newProject);
  } catch (err) {
    console.error("Proje oluşturulurken hata:", err);
    res.status(500).json({ error: "Proje oluşturulamadı" });
  }
});

// Proje güncelle
app.put("/api/projects/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Proje adı gerekli" });
    }

    const projects = await loadProjects();
    const projectIndex = projects.findIndex(p => p.id === id);

    if (projectIndex === -1) {
      return res.status(404).json({ error: "Proje bulunamadı" });
    }

    projects[projectIndex].name = name.trim();
    await saveProjects(projects);

    res.json(projects[projectIndex]);
  } catch (err) {
    console.error("Proje güncellenirken hata:", err);
    res.status(500).json({ error: "Proje güncellenemedi" });
  }
});

// Proje sil
app.delete("/api/projects/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const projects = await loadProjects();
    const filteredProjects = projects.filter(p => p.id !== id);

    if (projects.length === filteredProjects.length) {
      return res.status(404).json({ error: "Proje bulunamadı" });
    }

    await saveProjects(filteredProjects);

    res.json({ success: true, message: "Proje silindi" });
  } catch (err) {
    console.error("Proje silinirken hata:", err);
    res.status(500).json({ error: "Proje silinemedi" });
  }
});

// Karakter endpoint'leri
// Projeye ait karakterleri getir
app.get("/api/projects/:projectId/characters", async (req, res) => {
  try {
    const { projectId } = req.params;
    const allCharacters = await loadCharacters();
    const projectCharacters = allCharacters[projectId] || [];
    res.json(projectCharacters);
  } catch (err) {
    console.error("Karakterler yüklenirken hata:", err);
    res.status(500).json({ error: "Karakterler yüklenemedi" });
  }
});

// Yeni karakter oluştur
app.post("/api/projects/:projectId/characters", async (req, res) => {
  try {
    const { projectId } = req.params;
    const characterData = req.body;

    if (!characterData.firstName || !characterData.lastName) {
      return res.status(400).json({ error: "İsim ve soyisim gerekli" });
    }

    const allCharacters = await loadCharacters();
    const projectCharacters = allCharacters[projectId] || [];

    const newCharacter = {
      id: generateCharacterId(),
      ...characterData,
      createdAt: new Date().toISOString()
    };

    projectCharacters.push(newCharacter);
    allCharacters[projectId] = projectCharacters;
    await saveCharacters(allCharacters);

    res.json(newCharacter);
  } catch (err) {
    console.error("Karakter oluşturulurken hata:", err);
    res.status(500).json({ error: "Karakter oluşturulamadı" });
  }
});

// Karakter güncelle
app.put("/api/projects/:projectId/characters/:characterId", async (req, res) => {
  try {
    const { projectId, characterId } = req.params;
    const characterData = req.body;

    const allCharacters = await loadCharacters();
    const projectCharacters = allCharacters[projectId] || [];
    const characterIndex = projectCharacters.findIndex(c => c.id === characterId);

    if (characterIndex === -1) {
      return res.status(404).json({ error: "Karakter bulunamadı" });
    }

    projectCharacters[characterIndex] = {
      ...projectCharacters[characterIndex],
      ...characterData,
      id: characterId // ID değiştirilmemeli
    };

    allCharacters[projectId] = projectCharacters;
    await saveCharacters(allCharacters);

    res.json(projectCharacters[characterIndex]);
  } catch (err) {
    console.error("Karakter güncellenirken hata:", err);
    res.status(500).json({ error: "Karakter güncellenemedi" });
  }
});

// Karakter sil
app.delete("/api/projects/:projectId/characters/:characterId", async (req, res) => {
  try {
    const { projectId, characterId } = req.params;

    const allCharacters = await loadCharacters();
    const projectCharacters = allCharacters[projectId] || [];
    const filteredCharacters = projectCharacters.filter(c => c.id !== characterId);

    if (projectCharacters.length === filteredCharacters.length) {
      return res.status(404).json({ error: "Karakter bulunamadı" });
    }

    allCharacters[projectId] = filteredCharacters;
    await saveCharacters(allCharacters);

    res.json({ success: true, message: "Karakter silindi" });
  } catch (err) {
    console.error("Karakter silinirken hata:", err);
    res.status(500).json({ error: "Karakter silinemedi" });
  }
});

// Resim upload endpoint'i - Cloudinary kullanıyor
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "Dosya bulunamadı" });
    }

    console.log("Dosya yükleniyor, Cloudinary'ye gönderiliyor");
    console.log("Dosya adı:", req.file.originalname);
    console.log("Dosya boyutu:", req.file.size, "bytes");
    console.log("MIME type:", req.file.mimetype);

    // Buffer'ı Base64'e çevir (Cloudinary için)
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Cloudinary'ye yükle
    // Unsigned upload kullanıyoruz (credentials gerekmez)
    // Daha fazla kontrol için Cloudinary hesabı açıp upload preset oluşturabilirsin
    const uploadOptions = {
      folder: "character-gallery", // Klasör adı (opsiyonel)
      resource_type: "auto", // Otomatik format algılama
    };

    // Eğer credentials varsa signed upload, yoksa unsigned upload
    let uploadResult;
    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET) {
      uploadOptions.upload_preset = process.env.CLOUDINARY_UPLOAD_PRESET;
      uploadResult = await cloudinary.uploader.upload(base64Image, uploadOptions);
    } else {
      // Unsigned upload için cloud_name gerekli
      // Eğer yoksa, kullanıcıya Cloudinary hesabı açmasını söyle
      if (!process.env.CLOUDINARY_CLOUD_NAME) {
        throw new Error("CLOUDINARY_CLOUD_NAME environment variable eksik. Lütfen Cloudinary hesabı aç ve cloud_name'i ekle.");
      }
      uploadOptions.upload_preset = "ml_default"; // Varsayılan preset (Cloudinary'de oluşturulmalı)
      uploadResult = await cloudinary.uploader.upload(base64Image, uploadOptions);
    }

    if (!uploadResult || !uploadResult.secure_url) {
      throw new Error("Cloudinary yanıtında URL bulunamadı");
    }

    const imageUrl = uploadResult.secure_url;

    console.log("Upload başarılı, URL:", imageUrl);

    res.json({
      id: uploadResult.public_id,
      name: req.file.originalname,
      url: imageUrl,
    });
  } catch (err) {
    console.error("Upload hatası:", err);
    console.error("Hata detayı:", err.message);
    if (err.response) {
      console.error("Cloudinary yanıtı:", err.response.data);
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
