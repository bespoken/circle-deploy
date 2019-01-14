const AWS = require("aws-sdk");
const Config = require("./Config.js");

AWS.config.update({ region: process.env.AWS_DEFAULT_REGION });

class CloudWatchManager {
    static async registerEvent(TaskDefinitionArn) {
        const cwe = new AWS.CloudWatchEvents();
        const ruleName = Config.str("serviceName");
        const scheduleExpression = Config.str("cron");
        const ruleParams = {
            Name: ruleName, /* required */
            ScheduleExpression: scheduleExpression,
        };

        console.log("SCHEDULE 2.1) Register rule");
        await cwe.putRule(ruleParams).promise();

        const scheduleRole = Config.str("scheduleRole");
        const clusterArn = Config.str("clusterArn");
        const targetParams = {
            Rule: ruleName, /* required */
            Targets: [ /* required */
                {
                    Arn: clusterArn,
                    Id: ruleName, /* required */
                    EcsParameters: {
                        TaskDefinitionArn, /* required */
                        Group: ruleName,
                        LaunchType: "FARGATE",
                        NetworkConfiguration: {
                            awsvpcConfiguration: {
                                Subnets: Config.str("subnets"),
                                AssignPublicIp: "DISABLED",
                                SecurityGroups: [Config.str("securityGroup")],
                            }
                        },
                        PlatformVersion: "LATEST",
                        TaskCount: 1
                    },
                    RoleArn: scheduleRole,
                },
            ]
        };
        console.log("SCHEDULE 2.2) Register target");
        const targetResponse = await cwe.putTargets(targetParams).promise();
        return targetResponse;
    }
}
module.exports = CloudWatchManager;