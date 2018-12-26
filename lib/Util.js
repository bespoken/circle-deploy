class Util {
	static async sleep(time) {
		console.log("SLEEP: " + time);
		return new Promise((resolve) => {
			setTimeout(() => {
				resolve();
			}, time);
		});
	}
}

module.exports = Util;