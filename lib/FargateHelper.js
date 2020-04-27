const AWS = require("aws-sdk");
const Config = require("./Config.js");
const ECSManager = require("./ECSManager");
const ELBManager = require("./ELBManager");
const CloudWatchManager = require("./CloudWatchManager");
const fs = require("fs");
const Util = require("./Util");

class FargateHelper {
	static async run() {
		AWS.config.update({ region: process.env.AWS_DEFAULT_REGION });

		const options = { env: {} };
		const action = process.argv[2];
		for (let i = 3; i < process.argv.length; i += 2) {
			const keyString = process.argv[i];
			const value = process.argv[i + 1];
			const key = keyString.slice(2);

			if (key == "env") {
				const keyValue = value.split(/=(.+)/);
				const envKey = keyValue[0];
				options.env[envKey] = keyValue[1];
			} else if (key == "envFile") {
				// Read in an env file
				const fileString = fs.readFileSync(value, "UTF-8");
				const lines = fileString.split("\n");
				for (const line of lines) {
					if (line.trim().indexOf("=") === -1) {
						continue;
					}
					const keyValue = line.trim().split(/=(.+)/);
					const envKey = keyValue[0];
					options.env[envKey] = keyValue[1];
				}
			} else {
				options[key] = value;
			}
		}

		await Config.initialize(options);

		// We allow just name to be passed, but we reference it as service name throughout
		if (Config.has("name")) {
			Config.set("serviceName", Config.str("name"));
		}

		if (action === "create") {
			return FargateHelper._create();
		} else if (action === "delete") {
			return FargateHelper._delete();
		} else if (action === "service") {
			return FargateHelper._service();
		} else if (action === "update") {
			return FargateHelper._update();
		} else if (action === "schedule") {
			return FargateHelper._schedule();
		}
	}

	// Creates a new service
	static async _create() {
		const serviceName = Config.str("serviceName");

		// Create the service if it does not exist - otherwise, throw an error
		let service = await ECSManager.describeService(serviceName);
		if (service && service.status !== "INACTIVE") {
			throw new Error("Service already exists: " + serviceName + ". Delete or update instead.");
		}

		// Register the task definition first
		console.log("CREATE 1) Register Task Definition");
		const taskDefinition = await ECSManager.registerTaskDefinition();
		const taskDefinitionArn = taskDefinition.taskDefinition.taskDefinitionArn;

		// Creating a new service
		// We create a target group to associate this service with an Elastic Load Balancer
		console.log("CREATE 2) Create Target Group");
		const targetGroupResponse = await ELBManager.createTargetGroup();
		console.log("TargetGroupResponse: " + JSON.stringify(targetGroupResponse, null, 2));
		const targetGroupArn = targetGroupResponse.TargetGroups[0].TargetGroupArn;

		// We create a rule that tells our load balancer when to send requests to our new service
		// By default, it forwards <SERVICE_NAME>.bespoken.io to the service
		// This can be changed online in the ECS console
		console.log("CREATE 3) Create Rule");
		const rules = await ELBManager.createRule(targetGroupArn);
		console.log("Rules: " + JSON.stringify(rules, null, 2));

		// Create the service
		console.log("CREATE 4) Create Service");
		service = await ECSManager.createService(targetGroupArn, taskDefinitionArn);
		return service;
	}

	// Deletes an existing service, and related ELB stuff (rules and target group)
	static async _delete() {
		const serviceName = Config.str("serviceName");

		console.log("DELETE 1) Find Target Group Arn");

		const targetGroup = await ELBManager.describeTargetGroup(serviceName);
		const targetGroupArn = targetGroup.TargetGroupArn;
		if (!targetGroupArn) {
			throw new Error("Could not find target group associated with service: " + serviceName);
		}

		console.log("DELETE 2) Find ELB Rule for Target Group");

		// List the rules for our core listener
		// Find the one that refers to our target group from the previous step
		const rules = await ELBManager.describeRules(Config.str("listenerArn"));
		let ruleArn;
		for (const rule of rules) {
			for (const action of rule.Actions) {
				if (action.TargetGroupArn === targetGroupArn) {
					ruleArn = rule.RuleArn;
					console.log("FOUND RULE: " + ruleArn);
					break;
				}
			}

			if (ruleArn) {
				break;
			}
		}

		// If we found the rule delete - this should always happen, but we do as an if statement for safety
		if (ruleArn) {
			console.log("DELETE 3) Delete Rule");
			await ELBManager.deleteRule(ruleArn);
		}

		// Sleep for a little bit - otherwise we get a message saying the rule still exists
		await Util.sleep(10000);

		console.log("DELETE 4) Delete Target Group");
		await ELBManager.deleteTargetGroup(targetGroupArn);

		console.log("DELETE 5) Delete Service");
		await ECSManager.deleteService();
	}

	static async _service() {
		const serviceName = Config.str("serviceName");

		// Create the service if it does not exist - otherwise, update it
		let service = await ECSManager.describeService(serviceName);
		// If the service exists, and it is not inactive, then update
		if (service && service.status !== "INACTIVE") {
			return FargateHelper._update();
		} else {
			return FargateHelper._create();
		}
	}

	// Updates an existing service
	static async _update() {
		const serviceName = Config.str("serviceName");

		let service = await ECSManager.describeService(serviceName);
		if (!service) {
			throw new Error("Service does not exist: " + serviceName + ". Create instead.");
		} else if (service.status === "DRAINING") {
			throw new Error("Service is still draining. Cannot update.");
		} else if (service.status === "INACTIVE") {
			throw new Error("Service has been deleted. Try creating it again instead.");
		}

		console.log("UPDATE Status: " + service.status);

		// Register the task definition first
		console.log("UPDATE 1) Register Task Definition");
		const taskDefinition = await ECSManager.registerTaskDefinition();
		const taskDefinitionArn = taskDefinition.taskDefinition.taskDefinitionArn;

		// We need to call update service to use a new task definition
		console.log("UPDATE 2) Update Service");
		service = await ECSManager.updateService(taskDefinitionArn);
		return service;
	}

	// Creates a new service
	static async _schedule() {
		// Register the task definition first
		console.log("SCHEDULE 1) Register Task Definition");
		const taskDefinition = await ECSManager.registerTaskDefinition();
		const taskDefinitionArn = taskDefinition.taskDefinition.taskDefinitionArn;

		// Register a Cloudwatch event for this task definition as a cron job
		console.log("SCHEDULE 2) Register CloudWatch event")
		const targetSchedule = await CloudWatchManager.registerEvent(taskDefinitionArn);
		return targetSchedule;
	}
}

module.exports = FargateHelper;
