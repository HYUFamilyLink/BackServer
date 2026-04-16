const express = require("express");
const multer = require("multer");
const { convertSpeechToText } = require("../controllers/sttController");

const router = express.Router();

const upload = multer({
  dest: "uploads/",
});

router.post("/", upload.single("audio"), convertSpeechToText);

module.exports = router;