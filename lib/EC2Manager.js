const AWS = require("aws-sdk");
const Config = require("./Config.js");
const fs = require("fs");
const path = require("path");
const Util = require("./Util");

AWS.config.update({
    region: process.env.AWS_DEFAULT_REGION
});

// Manages interactions with EC2
// Allows for creating and terminating EC2 instances
class EC2Manager {
    static async launchInstance() {

        const userData = `#!/bin/bash\necho ECS_CLUSTER=${Config.str("cluster")} >> /etc/ecs/ecs.config`;
        const buff = Buffer.from(userData);
        let base64data = buff.toString('base64'); 

        const instanceInfo = {
            IamInstanceProfile: {
                Name: Config.str("IAMInstanceProfile")
              },
            ImageId: Config.str("imageId"),
            InstanceType: Config.str("instanceType"),
            KeyName: Config.str("keyPair"),
            MaxCount: Config.int("maxCount",1),
            MinCount: Config.int("minCount",1),
            SecurityGroupIds: [Config.str("securityGroup")],
            SubnetId: Config.str("subnets").toString().split(",")[0], //it only accepts one subnet
            UserData: base64data
        };

        const ec2 = new AWS.EC2();
        const instance = await ec2.runInstances(instanceInfo).promise();
        return instance;
    }
}

module.exports = EC2Manager;