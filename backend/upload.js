const multer = require("multer");
const path = require("path");

const storage = multer.memoryStorage();

module.exports = multer({
	storage,
	limits: {
		fileSize: 4 * 1024 * 1024
	}
});