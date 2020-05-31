Use plugin to copy data from source org and insert in destination org

1. Define export.json that directs plugin to fetch data from source org and insert in destination org
2. run cli command by passing path of export json folder
3. lookups are handled and mapped by plugin. Note that all lookup objects taht are refered are addedd as query 

# CLI Command
sfdx sfdmu:run --sourceusername <username>  --targetusername <username> --path <foldername>
## Example
``
    sfdx sfdmu:run --sourceusername sfdx.plugin@source.com  --targetusername sfdx.plugin@target.com --path "/Export"

``

## Parameters
 --sourceusername : Provide source org user name
 --targetusername : Provide target org user name
 --path           : provide path where export.json is located



 # export.json structure

 1. pollingIntervalMs : 2000 millisecond
 2. bulkThreshold     : set max limit of records that can be processed in single batch
 3. apiVersion        : set api version of both orgs
 4. orgs              : array of objects that defines org instance url ,user name and access token
 5. objects           : array of objects that define query,opration..etc
 


 ## orgs
 1. name        : define org user name that is passed using cli
 2. instanceUrl : define org instance url
 3. accessToken : define org access token that is used during api call

 ``
    {
        "name": "sfdx.plugin@source.com",
        "instanceUrl": "https://sfdx-source.my.salesforce.com",
        "accessToken": "Access Token"
    }
 ``

 ## objects
 1. query       : define query using which it fetches the data from source org
 2. operation   : define operation 'Insert,Upsert,Update' 
 3. externalId  : define externalId that is used during upsert,update opration to map record
 4. allRecords  : set to true to include records from recycle bin

 ``
    {
        "query": "SELECT Id,RecordTypeId FROM Account",
        "operation": "Insert",
        "externalId": "Id",
        "allRecords": true
    }
``