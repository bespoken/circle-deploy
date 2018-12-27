class Util {
	static async sleep(time) {
		console.log("SLEEP: " + time);
		return new Promise((resolve) => {
			setTimeout(() => {
				resolve();
			}, time);
		});
	}

	static substitute(s, token, value) {
		return s.split("${" + token + "}").join(value);
	}
}

module.exports = Util;