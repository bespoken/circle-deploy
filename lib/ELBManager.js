const AWS = require("aws-sdk");
const Config = require("./Config.js");

AWS.config.update({ region: process.env.AWS_DEFAULT_REGION });

// Manages interactions with AWS SDK for Elastic Load Balancers (using ELBv2 API)
class ELBManager {
	// Creates a rule that associates <SERVICE_NAME>.bespoken.io with the named target group
	static async createRule(targetGroupArn) {
		const client = new AWS.ELBv2();
		const listenerArn = Config.str("listenerArn");
		
		// Need to go through the listener to figure out the highest priority rule
		const rules = await ELBManager.describeRules(listenerArn);
		let highestPriority = 0;
		for (const rule of rules) {
			const priority = parseInt(rule.Priority);
			if (priority > highestPriority) {
				highestPriority = priority;
			}
		}

		let hostname = Config.str("serviceName") + ".bespoken.io";
		if (Config.has("hostname")) {
			hostname = Config.str("hostname");
		}
		
		var params = {
			Actions: [
			   	{
			  		TargetGroupArn: targetGroupArn, 
			  		Type: "forward"
			 	}
			], 
			Conditions: [
				{
			  		Field: "host-header", 
			  		Values: [hostname]
			 	}
			], 
			ListenerArn: listenerArn, 
			Priority: highestPriority + 1,
		};
		const response = await client.createRule(params).promise();
		return response;
	}

	// Creates a target group for the service
	// Health check with overrideable defaults is also created
	static async createTargetGroup() {
		const client = new AWS.ELBv2();
		var params = {
			Name: Config.str("serviceName"),
			HealthCheckEnabled: Config.bool("healthCheckEnabled", true),
			HealthCheckIntervalSeconds: Config.int("healthCheckIntervalSeconds", 30),
			HealthCheckPath: Config.str("healthCheckPath", "/"),
			HealthCheckPort: Config.str("containerPort"),
			HealthCheckProtocol: Config.str("healthCheckProtocol", "HTTP"),
			HealthCheckTimeoutSeconds: Config.int("healthCheckTimeoutSeconds", 5),
			HealthyThresholdCount: Config.int("unhealthyThresholdCount", 3),
			Matcher: {
			  HttpCode: "200"
			},
			Port: Config.int("containerPort"),
			Protocol: "HTTP",
			TargetType: "ip",
			UnhealthyThresholdCount: Config.int("unhealthyThresholdCount", 3),
			VpcId: Config.str("vpcId")
		};
		console.log("TargetGroup: " + JSON.stringify(params, null, 2));
		const targetGroupResponse = await client.createTargetGroup(params).promise();
		return targetGroupResponse;
	}

	static async deleteRule(ruleArn) {
		const client = new AWS.ELBv2();
		console.log("DELETING RULE: " + ruleArn);
		const ruleResponse = await client.deleteRule({
			RuleArn: ruleArn
		}).promise();
		return ruleResponse;
	}

	static async deleteTargetGroup(targetGroupArn) {
		const client = new AWS.ELBv2();
		const response = await client.deleteTargetGroup({
			TargetGroupArn: targetGroupArn
		}).promise();
		return response;
	}

	static async describeRules(listenerArn) {
		const client = new AWS.ELBv2();
		const listenerResponse = await client.describeRules({
			ListenerArn: listenerArn
		}).promise();
		return listenerResponse.Rules;
	}

	static async describeTargetGroup(targetGroupArn) {
		const client = new AWS.ELBv2();
		const targetGroupsResponse = await client.describeTargetGroups({
			TargetGroupArns: [targetGroupArn]
		}).promise();

		console.log("TargetGroups: " + JSON.stringify(targetGroupsResponse, null, 2));
	}
}

module.exports = ELBManager;