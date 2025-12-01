require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const fs = require("fs").promises;
const path = require("path");
const axios = require("axios");

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
// Karakter görsellerini tutmak için dosya yolu
const CHARACTER_IMAGES_FILE = path.join(__dirname, "data", "character-images.json");

// GitHub API yapılandırması (kalıcı veri için)
const GITHUB_OWNER = process.env.GITHUB_OWNER || "Timukuu";
const GITHUB_REPO = process.env.GITHUB_REPO || "character-backend";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Personal Access Token
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || "main";

// GitHub API'ye dosya commit et
async function commitToGitHub(filePath, content, message) {
  if (!GITHUB_TOKEN) {
    console.warn("GITHUB_TOKEN yok, veriler sadece geçici olarak kaydedilecek");
    return;
  }

  try {
    const fileContent = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    const base64Content = Buffer.from(fileContent).toString("base64");

    // Önce dosyanın mevcut SHA'sını al (varsa)
    let sha = null;
    try {
      const getResponse = await axios.get(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
        {
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json"
          },
          params: { ref: GITHUB_BRANCH }
        }
      );
      sha = getResponse.data.sha;
    } catch (err) {
      // Dosya yoksa, yeni oluşturulacak
      if (err.response?.status !== 404) throw err;
    }

    // Dosyayı commit et
    const commitResponse = await axios.put(
      `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
      {
        message: message,
        content: base64Content,
        branch: GITHUB_BRANCH,
        ...(sha && { sha: sha }) // Güncelleme için SHA gerekli
      },
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json"
        }
      }
    );

    console.log(`GitHub'a commit edildi: ${filePath}`);
    return commitResponse.data;
  } catch (err) {
    console.error("GitHub commit hatası:", err.response?.data || err.message);
    throw err;
  }
}

// Proje verilerini yükle (önce GitHub'dan, yoksa local'den)
async function loadProjects() {
  // Önce GitHub'dan yüklemeyi dene
  if (GITHUB_TOKEN) {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/data/projects.json`,
        {
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json"
          },
          params: { ref: GITHUB_BRANCH }
        }
      );
      const content = Buffer.from(response.data.content, "base64").toString("utf8");
      const projects = JSON.parse(content);
      
      // Local'e de kaydet (cache için)
      await fs.mkdir(path.dirname(PROJECTS_FILE), { recursive: true });
      await fs.writeFile(PROJECTS_FILE, content);
      
      return projects;
    } catch (err) {
      if (err.response?.status !== 404) {
        console.error("GitHub'dan yüklenirken hata:", err.message);
      }
      // GitHub'da yoksa local'den yükle
    }
  }

  // Local'den yükle
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

// Proje verilerini kaydet (hem local hem GitHub'a)
async function saveProjects(projects) {
  const content = JSON.stringify(projects, null, 2);
  
  // Local'e kaydet (hızlı erişim için)
  await fs.mkdir(path.dirname(PROJECTS_FILE), { recursive: true });
  await fs.writeFile(PROJECTS_FILE, content);

  // GitHub'a commit et (kalıcılık için)
  if (GITHUB_TOKEN) {
    try {
      await commitToGitHub("data/projects.json", content, `Update projects: ${new Date().toISOString()}`);
    } catch (err) {
      console.error("GitHub'a kaydedilemedi, sadece local kaydedildi:", err.message);
    }
  }
}

// ID oluştur
function generateProjectId() {
  return "proje-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function generateCharacterId() {
  return "char-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// Karakter verilerini yükle (önce GitHub'dan, yoksa local'den)
async function loadCharacters() {
  // Önce GitHub'dan yüklemeyi dene
  if (GITHUB_TOKEN) {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/data/characters.json`,
        {
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json"
          },
          params: { ref: GITHUB_BRANCH }
        }
      );
      const content = Buffer.from(response.data.content, "base64").toString("utf8");
      const characters = JSON.parse(content);
      
      // Local'e de kaydet (cache için)
      await fs.mkdir(path.dirname(CHARACTERS_FILE), { recursive: true });
      await fs.writeFile(CHARACTERS_FILE, content);
      
      return characters;
    } catch (err) {
      if (err.response?.status !== 404) {
        console.error("GitHub'dan yüklenirken hata:", err.message);
      }
      // GitHub'da yoksa local'den yükle
    }
  }

  // Local'den yükle
  try {
    const data = await fs.readFile(CHARACTERS_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    // Dosya yoksa boş obje döndür
    return {};
  }
}

// Karakter verilerini kaydet (hem local hem GitHub'a)
async function saveCharacters(characters) {
  const content = JSON.stringify(characters, null, 2);
  
  // Local'e kaydet (hızlı erişim için)
  await fs.mkdir(path.dirname(CHARACTERS_FILE), { recursive: true });
  await fs.writeFile(CHARACTERS_FILE, content);

  // GitHub'a commit et (kalıcılık için)
  if (GITHUB_TOKEN) {
    try {
      await commitToGitHub("data/characters.json", content, `Update characters: ${new Date().toISOString()}`);
    } catch (err) {
      console.error("GitHub'a kaydedilemedi, sadece local kaydedildi:", err.message);
    }
  }
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

// CharacterImage yükle/kaydet fonksiyonları
async function loadCharacterImages() {
  // Önce GitHub'dan yüklemeyi dene
  if (GITHUB_TOKEN) {
    try {
      const response = await axios.get(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/data/character-images.json`,
        {
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json"
          },
          params: { ref: GITHUB_BRANCH }
        }
      );
      const content = Buffer.from(response.data.content, "base64").toString("utf8");
      const images = JSON.parse(content);
      
      await fs.mkdir(path.dirname(CHARACTER_IMAGES_FILE), { recursive: true });
      await fs.writeFile(CHARACTER_IMAGES_FILE, content);
      
      return images;
    } catch (err) {
      if (err.response?.status !== 404) {
        console.error("GitHub'dan yüklenirken hata:", err.message);
      }
    }
  }

  try {
    const data = await fs.readFile(CHARACTER_IMAGES_FILE, "utf8");
    return JSON.parse(data);
  } catch (err) {
    return {}; // characterId -> image array mapping
  }
}

async function saveCharacterImages(images) {
  const content = JSON.stringify(images, null, 2);
  
  await fs.mkdir(path.dirname(CHARACTER_IMAGES_FILE), { recursive: true });
  await fs.writeFile(CHARACTER_IMAGES_FILE, content);

  if (GITHUB_TOKEN) {
    try {
      await commitToGitHub("data/character-images.json", content, `Update character images: ${new Date().toISOString()}`);
    } catch (err) {
      console.error("GitHub'a kaydedilemedi:", err.message);
    }
  }
}

function generateImageId() {
  return "img-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

// CharacterImage endpoint'leri
// Karaktere ait tüm görselleri getir
app.get("/api/characters/:characterId/images", async (req, res) => {
  try {
    const { characterId } = req.params;
    const allImages = await loadCharacterImages();
    const characterImages = allImages[characterId] || [];
    res.json(characterImages);
  } catch (err) {
    console.error("Görseller yüklenirken hata:", err);
    res.status(500).json({ error: "Görseller yüklenemedi" });
  }
});

// Yeni görsel ekle
app.post("/api/characters/:characterId/images", async (req, res) => {
  try {
    const { characterId } = req.params;
    const { url, fileName, title, description, tags, createdByUserId } = req.body;

    if (!url || !title) {
      return res.status(400).json({ error: "URL ve başlık gerekli" });
    }

    const allImages = await loadCharacterImages();
    const characterImages = allImages[characterId] || [];

    const newImage = {
      id: generateImageId(),
      characterId,
      url,
      fileName: fileName || "",
      title: title.trim(),
      description: description || "",
      tags: Array.isArray(tags) ? tags : (tags ? tags.split(",").map(t => t.trim()) : []),
      createdAt: new Date().toISOString(),
      createdByUserId: createdByUserId || "system"
    };

    characterImages.push(newImage);
    allImages[characterId] = characterImages;
    await saveCharacterImages(allImages);

    res.json(newImage);
  } catch (err) {
    console.error("Görsel oluşturulurken hata:", err);
    res.status(500).json({ error: "Görsel oluşturulamadı" });
  }
});

// Görsel güncelle
app.put("/api/images/:imageId", async (req, res) => {
  try {
    const { imageId } = req.params;
    const { title, description, tags } = req.body;

    const allImages = await loadCharacterImages();
    
    // Tüm karakterlerde ara
    for (const characterId in allImages) {
      const images = allImages[characterId];
      const imageIndex = images.findIndex(img => img.id === imageId);
      
      if (imageIndex !== -1) {
        images[imageIndex] = {
          ...images[imageIndex],
          title: title !== undefined ? title.trim() : images[imageIndex].title,
          description: description !== undefined ? description : images[imageIndex].description,
          tags: tags !== undefined ? (Array.isArray(tags) ? tags : tags.split(",").map(t => t.trim())) : images[imageIndex].tags,
          updatedAt: new Date().toISOString()
        };
        
        await saveCharacterImages(allImages);
        return res.json(images[imageIndex]);
      }
    }

    return res.status(404).json({ error: "Görsel bulunamadı" });
  } catch (err) {
    console.error("Görsel güncellenirken hata:", err);
    res.status(500).json({ error: "Görsel güncellenemedi" });
  }
});

// Görsel sil
app.delete("/api/images/:imageId", async (req, res) => {
  try {
    const { imageId } = req.params;

    const allImages = await loadCharacterImages();
    
    // Tüm karakterlerde ara
    for (const characterId in allImages) {
      const images = allImages[characterId];
      const filteredImages = images.filter(img => img.id !== imageId);
      
      if (images.length !== filteredImages.length) {
        allImages[characterId] = filteredImages;
        await saveCharacterImages(allImages);
        return res.json({ success: true, message: "Görsel silindi" });
      }
    }

    return res.status(404).json({ error: "Görsel bulunamadı" });
  } catch (err) {
    console.error("Görsel silinirken hata:", err);
    res.status(500).json({ error: "Görsel silinemedi" });
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
