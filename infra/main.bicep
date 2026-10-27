param location string = resourceGroup().location
param adminObjectId string
param adminLogin string
param budgetEmail string
param supabaseUrl string
@secure()
param supabasePublishableKey string
param budgetStart string = utcNow('yyyy-MM-01')

var suffix = uniqueString(resourceGroup().id, location)
var tags = { application: 'dinknpc', environment: 'development' }
var subnetId = '${network.id}/subnets/functions'

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-dinknpc-${suffix}'
  location: location
  tags: tags
}
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: 'stdink${suffix}'
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: { name: 'Standard_LRS' }
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
  }
  resource blobs 'blobServices' = {
    name: 'default'
    resource packages 'containers' = {
      name: 'deployments'
      properties: { publicAccess: 'None' }
    }
  }
}
var storageRoles = [
  'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
]
resource storageAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = [for role in storageRoles: {
  name: guid(storage.id, identity.id, role)
  scope: storage
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', role)
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}]
resource network 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: 'vnet-dinknpc'
  location: location
  tags: tags
  properties: {
    addressSpace: { addressPrefixes: ['10.74.0.0/16'] }
    subnets: [{
      name: 'functions'
      properties: {
        addressPrefix: '10.74.1.0/24'
        delegations: [{
          name: 'functions'
          properties: { serviceName: 'Microsoft.App/environments' }
        }]
        serviceEndpoints: [{ service: 'Microsoft.Sql' }]
      }
    }]
  }
}
resource sqlServer 'Microsoft.Sql/servers@2023-08-01' = {
  name: 'sql-dinknpc-${suffix}'
  location: location
  tags: tags
  properties: {
    version: '12.0'
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
    administrators: {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: true
      principalType: 'User'
      login: adminLogin
      sid: adminObjectId
      tenantId: subscription().tenantId
    }
  }
  resource database 'databases' = {
    name: 'dinknpc'
    location: location
    tags: tags
    sku: { name: 'Standard', tier: 'Standard', capacity: 10 }
    properties: {
      collation: 'Latin1_General_100_BIN2'
      maxSizeBytes: 42949672960
      useFreeLimit: false
    }
  }
  resource functionAccess 'virtualNetworkRules' = {
    name: 'functions-only'
    properties: {
      virtualNetworkSubnetId: subnetId
      ignoreMissingVnetServiceEndpoint: false
    }
  }
}
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-dinknpc-${suffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    workspaceCapping: { dailyQuotaGb: json('0.1') }
  }
}
resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-dinknpc-${suffix}'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
    DisableLocalAuth: true
  }
}
resource metricsAccess 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(insights.id, identity.id, 'metrics')
  scope: insights
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '3913510d-42f4-4e42-8a64-420c390055eb')
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'plan-dinknpc'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: { name: 'FC1', tier: 'FlexConsumption' }
  properties: { reserved: true }
}
resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: 'func-dinknpc-${suffix}'
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    virtualNetworkSubnetId: subnetId
    siteConfig: { minTlsVersion: '1.2' }
    functionAppConfig: {
      runtime: { name: 'node', version: '24' }
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}deployments'
          authentication: {
            type: 'UserAssignedIdentity'
            userAssignedIdentityResourceId: identity.id
          }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
        triggers: { http: { perInstanceConcurrency: 4 } }
      }
    }
  }
  resource settings 'config' = {
    name: 'appsettings'
    properties: {
      AzureWebJobsStorage__accountName: storage.name
      AzureWebJobsStorage__credential: 'managedidentity'
      AzureWebJobsStorage__clientId: identity.properties.clientId
      APPLICATIONINSIGHTS_CONNECTION_STRING: insights.properties.ConnectionString
      APPLICATIONINSIGHTS_AUTHENTICATION_STRING: 'ClientId=${identity.properties.clientId};Authorization=AAD'
      AZURE_CLIENT_ID: identity.properties.clientId
      AZURE_SQL_SERVER: sqlServer.properties.fullyQualifiedDomainName
      AZURE_SQL_DATABASE: sqlServer::database.name
      SUPABASE_URL: supabaseUrl
      SUPABASE_PUBLISHABLE_KEY: supabasePublishableKey
      FUNCTIONS_REQUEST_BODY_SIZE_LIMIT: '65536'
    }
  }
}
resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: 'dinknpc-development'
  properties: {
    category: 'Cost'
    amount: 50
    timeGrain: 'Monthly'
    timePeriod: { startDate: '${budgetStart}T00:00:00Z' }
    notifications: {
      actual80: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 80, thresholdType: 'Actual', contactEmails: [budgetEmail] }
      actual100: { enabled: true, operator: 'GreaterThanOrEqualTo', threshold: 100, thresholdType: 'Actual', contactEmails: [budgetEmail] }
    }
  }
}

output functionAppName string = app.name
output apiUrl string = 'https://${app.properties.defaultHostName}/api'
output sqlServerName string = sqlServer.name
output sqlServerHost string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = sqlServer::database.name
output apiIdentityName string = identity.name
output apiIdentityClientId string = identity.properties.clientId
output apiIdentityObjectId string = identity.properties.principalId
