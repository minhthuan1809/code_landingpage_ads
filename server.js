const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const { initDb, seedIfEmpty, seedAdmin } = require("./lib/db");
const { startPublicIpDetection } = require("./lib/server-ip");
const { getServerConfig } = require("./lib/urls");
const publicRoutes = require("./routes/public");
const adminRoutes = require("./routes/admin");

const ADMIN_PORT = Number(process.env.ADMIN_PORT) || 4433;
const LANDING_PORT = Number(process.env.LANDING_PORT) || 4444;

function createLandingApp() {
  const app = express();
  app.set("trust proxy", true);
  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.use("/uploads", express.static(path.join(__dirname, "public", "uploads")));
  app.use("/css", express.static(path.join(__dirname, "public", "css")));
  app.use("/", publicRoutes);

  return app;
}

function createAdminApp() {
  const app = express();
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

  app.get("/", (_req, res) => {
    res.redirect("/admin/");
  });

  return app;
}

initDb()
  .then(async () => {
    seedAdmin();
    seedIfEmpty();
    await startPublicIpDetection();

    const config = getServerConfig();
    const landingApp = createLandingApp();
    const adminApp = createAdminApp();

    landingApp.listen(LANDING_PORT, () => {
      console.log(`  Landing:    http://localhost:${LANDING_PORT}`);
      if (config.publicIp) {
        console.log(`              http://${config.publicIp}:${LANDING_PORT}`);
      }
    });

    adminApp.listen(ADMIN_PORT, () => {
      console.log(`\n  🛍  LANDING PAGE CMS`);
      console.log(`  Admin:      http://localhost:${ADMIN_PORT}/admin/`);
      if (config.publicIp) {
        console.log(`              http://${config.publicIp}:${ADMIN_PORT}/admin/`);
      }
      console.log(`  SQLite:     data/shop.db`);
      console.log(`  Đăng nhập:  admin / Thuan18092003\n`);
    });
  })
  .catch((err) => {
    console.error("Không khởi động được server:", err);
    process.exit(1);
  });
