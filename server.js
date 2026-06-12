const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const { initDb, seedIfEmpty, seedAdmin } = require("./lib/db");
const { startPublicIpDetection } = require("./lib/server-ip");
const { getServerConfig } = require("./lib/urls");
const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");

const app = express();
const PORT = process.env.PORT || 4433;

app.set("trust proxy", true);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));
app.use("/css", express.static(path.join(__dirname, "public", "css")));
app.use("/admin", express.static(path.join(__dirname, "public", "admin")));

app.use("/api/admin", adminRoutes);
app.use("/", publicRoutes);

initDb()
  .then(async () => {
    seedAdmin();
    seedIfEmpty();
    await startPublicIpDetection();

    const config = getServerConfig();
    app.listen(PORT, () => {
      console.log(`\n  🛍  LANDING PAGE CMS`);
      console.log(`  Trang web:  http://localhost:${PORT}`);
      if (config.publicIp) {
        console.log(`  Server IP:  ${config.publicIp} → ${config.baseUrl}`);
      }
      console.log(`  Admin:      http://localhost:${PORT}/admin/`);
      console.log(`  SQLite:     data/shop.db`);
      console.log(`  Đăng nhập:  admin / Thuan18092003\n`);
    });
  })
  .catch((err) => {
    console.error("Không khởi động được server:", err);
    process.exit(1);
  });
