'use strict';
//process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let request = require('request');
let _ = require('lodash');
let async = require('async');
let Logger;
/**
 * The startup method is called once when the integration is first loaded by the server.  It can be used
 * to do any initializations required (e.g., setting up persistent database connections)
 */
function startup(logger) {
    Logger = logger;
}


/**
 The doLookup method is called each time 1 or more entity objects needs to be looked up by the integration.  It is
 called on a per user basis. The method is passed an array of entity objects which have the following structure:

 ```json
 {
     isIP: true,
     isIPv4: true,
     isIPv6: false,
     isPrivateIP: false,
     IPType: 'IPv4',
     isHex: false,
     isHash: false,
     isMD5: false,
     isSHA1: false,
     isSHA256: false,
     isSHA512: false,
     hashType: '',
     isGeo: false,
     isEmail: false,
     isURL: false,
     isHTMLTag: false,
     latitude: 0,
     longitude: 0,
     value: '56.2.3.1',
     IPLong: 939655937
     }
 ```

 You can use information provided about the entity to decide whether or not to perform a lookup.

 In addition to passing you the entities, the method will pass you the options set by the user.  The options
 are contained in an object keyed on the option name.  For example for this integration the option object will look
 like

 ```json
 {
    sampleOption: 'default value'
 }
 ```

 @param entities Array of entity objects
 @param options Options for the user
 @param cb callback function
 */
function doLookup(entities, options, cb) {
    let validationResult = _validateOptions(options);
    if (validationResult !== null) {
        cb(validationResult);
        return;
    }


    let lookupResults = [];

    async.each(entities, function (entityObj, next) {
        Logger.trace({entity: entityObj.value}, 'Looking up Entity');
        if (entityObj.isIP && options.lookupIps) {
            Logger.trace({entity: entityObj.value}, 'Looking up IP');
            _lookupIP(entityObj, options, function (err, results) {
                if (err) {
                    next(err);
                } else {
                    for (let i = 0; i < results.length; i++) {
                        lookupResults.push(results[i]);
                    }
                    next(null);
                }
            });
        } else if ((entityObj.isMD5 || entityObj.isSHA1 || entityObj.isSHA256) && options.lookupHashes) {
            Logger.trace({entity: entityObj.value}, 'Looking up Hash');
            _lookupHash(entityObj, options, function (err, results) {
                if (err) {
                    next(err);
                } else {
                    for (let i = 0; i < results.length; i++) {
                        lookupResults.push(results[i]);
                    }
                    next(null);
                }
            });
        } else if (entityObj.isDomain && options.lookupDomains) {
            Logger.trace({entity: entityObj.value}, 'Looking up Domain');
            _lookupDomains(entityObj, options, function (err, results) {
                if (err) {
                    next(err);
                } else {
                    for (let i = 0; i < results.length; i++) {
                        lookupResults.push(results[i]);
                    }
                    next(null);
                }
            });
        } else {
            // entity is not a supported type so just continue
            next(null);
        }
    }, function (err) {
        /**
         * The callback should return 2 parameters
         *
         * @parameter as JSON api formatted error message or a string error message, null if there is no error
         *      Any error message returned here is displayed in the notification window for the user that experienced
         *      the error.  This is a good place to return errors related to API authentication or other issues.     *
         * @parameter lookupResults An array of lookup result objects
         */
        Logger.debug({lookupResults: lookupResults}, 'Lookup Results');
        cb(err, lookupResults);
    });
}

function _getHashSampleUri(hashType, value, options) {
    return _getFormattedHostname(options) + '/api/v1/samples/?only=filename,campaign,description,modified,source&' +
        'c-' + hashType.toLowerCase() + '=' + value.toLowerCase() + _getUriAuthQueryParam(options);
}

function _getPatchDescriptionUri(type, objectId, options) {
    return _getFormattedHostname(options) + '/api/v1/' + type + '/' + objectId + _getUriAuthQueryParam(options);
}

function _getIpUri(value, options) {
    return _getFormattedHostname(options) + '/api/v1/ips/?c-ip=' + value + _getUriAuthQueryParam(options);
}

function _getHashUri(hashType, value, options) {
    return _getFormattedHostname(options) + '/api/v1/indicators/?c-type=' + hashType.toUpperCase() +
        '&c-lower=' + value.toLowerCase() + _getUriAuthQueryParam(options);
}

function _getCritsHashUrl(options, object) {
    return _getFormattedHostname(options) + '/indicators/details/' + object._id + '/';
}

function _getCritsSampleUrl(options, object) {
    return _getFormattedHostname(options) + '/samples/details/' + object.md5 + '/';
}

function _getCritsIpUrl(options, object) {
    return _getFormattedHostname(options) + '/ips/details/' + object.ip + '/';
}

function _getUriAuthQueryParam(options) {
    return '&username=' + options.username + '&api_key=' + options.apiKey;
}

function _getCritsDomainUri(value, options) {
    return _getFormattedHostname(options) + '/api/v1/domains/?c-domain=' + value + _getUriAuthQueryParam(options);
}

function _getCritsDomainUrl(options, object) {
    return _getFormattedHostname(options) + '/domains/details/' + object.domain + '/';
}

/**
 * Removes trailing slash if the user added one
 *
 * @param options
 * @returns {string}
 * @private
 */
function _getFormattedHostname(options) {
    let hostname = options.hostname;
    if (hostname.endsWith("/")) {
        hostname = hostname.substring(0, hostname.length - 1);
    }
    return hostname;
}

function _processHashResults(err, response, body, cb) {
    let error = _getErrorMessage(err, response, body);

    if (error !== null) {
        cb(error);
        return;
    }

    let critObjects = body.objects;

    cb(null, critObjects);
}

function _lookupHash(entityObj, options, cb) {
    async.parallel({
        hashIndicators: function (parallelCb) {
            request({
                uri: _getHashUri(entityObj.hashType, entityObj.value, options),
                method: 'GET',
                json: true,
                rejectUnauthorized: false
            }, function (err, response, body) {
                _processHashResults(err, response, body, parallelCb);
            });
        },
        hashSamples: function (parallelCb) {
            request({
                uri: _getHashSampleUri(entityObj.hashType, entityObj.value, options),
                method: 'GET',
                json: true,
                rejectUnauthorized: false
            }, function (err, response, body) {
                _processHashResults(err, response, body, parallelCb);
            });
        }
    }, function (err, results) {
        if (err) {
            cb(err);
            return;
        }

        let payload = {
            entity: entityObj,
            data: {
                details: {
                    type: 'hash',
                    hashSamples: [],
                    hashIndicators: []
                }
            }
        };

        results.hashSamples.forEach(function (critsObject) {
            payload.data.details.hashSamples.push({
                filename: critsObject.filename,
                filenames: critsObject.filenames,
                critsLookupUrl: _getCritsSampleUrl(options, critsObject),
                bucketList: critsObject.bucket_list,
                campaign: critsObject.campaign,
                description: critsObject.description,
                modified: critsObject.modified,
                source: critsObject.source,
                patchDescriptionUri: _getPatchDescriptionUri('indicator', critsObject._id, options)
            })
        });

        results.hashIndicators.forEach(function (critsObject) {
            payload.data.details.hashIndicators.push({
                critsLookupUrl: _getCritsHashUrl(options, critsObject),
                bucketList: critsObject.bucket_list,
                campaign: critsObject.campaign,
                description: critsObject.description,
                modified: critsObject.modified,
                source: critsObject.source,
                threatTypes: critsObject.threat_types,
                patchDescriptionUri: _getPatchDescriptionUri('indicator', critsObject._id, options)
            })
        });

        if (results.hashIndicators.length === 0 && results.hashSamples.length === 0) {
            payload.data = null;
        } else {
            payload.data.summary = _createHashTags(payload.data.details);
        }

        cb(null, [payload]);
    });
}

function _getErrorMessage(err, response, body) {
    if (err && typeof err.code === 'string') {
        return err.code;
    }

    if (err && typeof err === 'object') {
        return JSON.stringify(err);
    }

    if (response.statusCode == 401) {
        return 'Unauthorized to access CRITs. Please check username and API key';
    }

    if (response.statusCode !== 200) {
        return 'There was an unknown error accessing CRITs';
    }

    return null;
}

function _lookupIP(entityObj, options, cb) {
    request({
        uri: _getIpUri(entityObj.value, options),
        method: 'GET',
        json: true,
        rejectUnauthorized: false
    }, function (err, response, body) {
        // check for an error
        let error = _getErrorMessage(err, response, body);
        if (error !== null) {
            cb(error);
            return;
        }

        let critObjects = body.objects;
        let results = [];

        if (critObjects.length === 0) {
            // no data so we add a null result which will cache this entity as a miss in
            // crits
            results.push({
                entity: entityObj,
                data: null
            })
        } else {
            for (let i = 0; i < critObjects.length; i++) {
                let object = critObjects[i];
                let critsLookupUrl = _getCritsIpUrl(options, object);

                results.push({
                    entity: entityObj,
                    displayValue: object.ip,
                    // Required: An object containing everything you want passed to the template
                    data: {
                        // Required: These are the tags that are displayed in your template
                        summary: _createTags(object),
                        // Data that you want to pass back to the notification window details block
                        details: {
                            type: 'ip',
                            critsLookupUrl: critsLookupUrl,
                            bucketList: object.bucket_list,
                            campaign: object.campaign,
                            description: object.description,
                            modified: object.modified,
                            source: object.source,
                            threatTypes: object.threat_types,
                            patchDescriptionUri: _getPatchDescriptionUri('ips', object._id, options)
                        }
                    }
                })
            }
        }

        cb(null, results);
    });
}

function _lookupDomains(entityObj, options, cb) {
    request({
        uri: _getCritsDomainUri(entityObj.value, options),
        method: 'GET',
        json: true,
        rejectUnauthorized: false
    }, function (err, response, body) {
        // check for an error
        let error = _getErrorMessage(err, response, body);
        if (error !== null) {
            cb(error);
            return;
        }

        let critObjects = body.objects;
        let results = [];

        if (critObjects.length === 0) {
            // no data so we add a null result which will cache this entity as a miss in
            // crits
            results.push({
                entity: entityObj,
                data: null
            })
        } else {
            for (let i = 0; i < critObjects.length; i++) {
                let object = critObjects[i];
                let critsLookupUrl = _getCritsDomainUrl(options, object);

                results.push({
                    entity: entityObj,
                    displayValue: object.domain,
                    // Required: An object containing everything you want passed to the template
                    data: {
                        // Required: These are the tags that are displayed in your template
                        summary: _createTags(object),
                        // Data that you want to pass back to the notification window details block
                        details: {
                            type: 'domain',
                            critsLookupUrl: critsLookupUrl,
                            bucketList: object.bucket_list,
                            campaign: object.campaign,
                            description: object.description,
                            modified: object.modified,
                            source: object.source,
                            threatTypes: object.threat_types,
                            patchDescriptionUri: _getPatchDescriptionUri('domains', object._id, options)
                        }
                    }
                })
            }
        }

        cb(null, results);
    });
}

function _createSourceMarker() {
    return ' <i class="bts bt-fw bt-map-marker integration-text-bold-color"></i>';
    //return "<span class='tag-marker ' title='Source'>S</span> "
}

function _createCampaignMarkger() {
    return ' <i class="fa fa-fw fa-bullhorn integration-text-bold-color"></i>';
    //return "<span class='tag-marker' title='Campaign'>C</span> "
}

function _createHashTags(details) {
    let tags = [];

    let uniqueSources = new Set();
    let uniqueCampaigns = new Set();
    let uniqueBucketLists = new Set();

    // push number of samples if any
    if (details.hashSamples.length === 1) {
        tags.push(details.hashSamples.length + ' <i class="fa fa-bug integration-text-bold-color"></i>');
    } else if (details.hashSamples.length > 1) {
        tags.push(details.hashSamples.length + ' <i class="fa fa-bug integration-text-bold-color"></i>');
    }

    details.hashSamples.forEach(function (sample) {
        // push source(s)
        if (Array.isArray(sample.source)) {
            sample.source.forEach(function(source){
               uniqueSources.add(source.name + _createSourceMarker());
            });
        }

        // push campaign name(s)
        if (Array.isArray(sample.campaign)) {
            sample.campaign.forEach(function(campaign){
               uniqueCampaigns.add(campaign.name + _createCampaignMarkger());
            });
        }

        // push bucket_list (array of tags)
        if (Array.isArray(sample.bucket_list)) {
            sample.bucket_list.forEach(function(bucket){
                uniqueBucketLists.add(bucket);
            });
        }
    });

    details.hashIndicators.forEach(function (indicator) {
        // push source(s)
        if (Array.isArray(indicator.source)) {
            indicator.source.forEach(function(source){
                uniqueSources.add(source.name + _createSourceMarker());
            });
        }

        // push campaign name(s)
        if (Array.isArray(indicator.campaign)) {
            indicator.campaign.forEach(function(campaign){
                uniqueCampaigns.add(campaign.name + _createCampaignMarkger());
            });
        }

        // push bucket_list (array of tags)
        if (Array.isArray(indicator.bucket_list)) {
            indicator.bucket_list.forEach(function(bucket){
                uniqueBucketLists.add(bucket);
            });
        }
    });

    uniqueSources.forEach(function(source){
        tags.push(source);
    });

    uniqueCampaigns.forEach(function(campaign){
        tags.push(campaign);
    });

    uniqueBucketLists.forEach(function(bucket){
        tags.push(bucket);
    });

    return tags;
}

function _createTags(object) {
    let tags = [];

    // push source(s)
    if (Array.isArray(object.source) && object.source.length > 0) {
        for (var i = 0; i < object.source.length; i++) {
            tags.push(object.source[i].name + _createSourceMarker());
        }
    }

    // push campaign name(s)
    if (Array.isArray(object.campaign) && object.campaign.length > 0) {
        for (var i = 0; i < object.campaign.length; i++) {
            tags.push(object.campaign[i].name + _createCampaignMarkger());
        }
    }

    // push bucket_list (array of tags)
    if (Array.isArray(object.bucket_list) && object.bucket_list.length > 0) {
        for (var i = 0; i < object.bucket_list.length && i < 5; i++) {
            tags.push(object.bucket_list[i]);
        }
    }

    return tags;
}

/**
 * Options to validate
 *
 * hostname
 * username
 * apiKey
 * lookupHashes
 * lookupIps
 *
 * @param options
 * @private
 */
function _validateOptions(options) {
    if (typeof options.hostname !== 'string') {
        return 'No hostname set';
    }

    if (options.hostname.length === 0) {
        return 'Hostname must be at least 1 character';
    }

    if (typeof options.apiKey !== 'string') {
        return 'No API key set';
    }

    if (options.apiKey.length === 0) {
        return 'API key must be at least 1 character';
    }

    if (typeof options.username !== 'string') {
        return 'No username set';
    }

    if (options.username.length === 0) {
        return 'Username must be at least 1 character';
    }

    return null;
}

module.exports = {
    doLookup: doLookup,
    startup: startup
};