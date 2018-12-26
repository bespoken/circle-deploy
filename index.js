#!/usr/bin/env node
require("dotenv").config();
process.env.AWS_DEFAULT_REGION = process.env.AWS_DEFAULT_REGION ? process.env.AWS_DEFAULT_REGION : "us-east-1";
		
const FargateHelper = require("./lib/FargateHelper");

FargateHelper.run().then(() => {
	console.log("DONE");
});

process.on("unhandledRejection", (e) => {
	console.error("UNHANDLED: " + e.stack);
	process.exit(1);
});
