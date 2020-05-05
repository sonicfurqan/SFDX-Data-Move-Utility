/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: BSD-3-Clause
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */


import { Common } from "../../components/common_components/common";
import { CONSTANTS } from "../../components/common_components/statics";
import { Logger, RESOURCES } from "../../components/common_components/logger";
import { Script, ScriptObject, MigrationJobTask as Task } from "..";
import * as path from 'path';
import * as fs from 'fs';



export default class MigrationJob {

    script: Script;
    tasks: Task[] = new Array<Task>();
    csvValuesMapping: Map<string, Map<string, string>> = new Map<string, Map<string, string>>();
    csvIssues: Array<ICSVIssues> = new Array<ICSVIssues>();
    cachedCSVContent: CachedCSVContent = new CachedCSVContent();

    constructor(init: Partial<MigrationJob>) {
        if (init) {
            Object.assign(this, init);
        }
    }

    get logger(): Logger {
        return this.script.logger;
    }

    get objects(): ScriptObject[] {
        return this.script.objects;
    }




    // ----------------------- Public methods -------------------------------------------    
    /**
     * Load CSVValues mapping definition file into the memory
     *
     * @returns {Promise<void>}
     * @memberof MigrationJob
     */
    async loadCSVValueMappingFileAsync(): Promise<void> {
        let valueMappingFilePath = path.join(this.script.basePath, CONSTANTS.VALUE_MAPPING_CSV_FILENAME);
        let csvRows = await Common.readCsvFileAsync(valueMappingFilePath);
        if (csvRows.length > 0) {
            this.logger.infoVerbose(RESOURCES.readingValuesMappingFile, CONSTANTS.VALUE_MAPPING_CSV_FILENAME);
            csvRows.forEach(row => {
                if (row["ObjectName"] && row["FieldName"]) {
                    let key = String(row["ObjectName"]).trim() + String(row["FieldName"]).trim();
                    if (!this.csvValuesMapping.has(key)) {
                        this.csvValuesMapping.set(key, new Map<string, string>());
                    }
                    this.csvValuesMapping.get(key).set(String(row["RawValue"]).trim(), (String(row["Value"]) || "").trim());
                }
            });
        }
    }

    /**
     * Merge User.csv and Group.csv into single file
     *
     * @returns {Promise<void>}
     * @memberof MigrationJob
     */
    async mergeUserGroupCSVfiles(): Promise<void> {
        let filepath1 = path.join(this.script.basePath, "User.csv");
        let filepath2 = path.join(this.script.basePath, "Group.csv");
        let filepath3 = path.join(this.script.basePath, CONSTANTS.USER_AND_GROUP_FILENAME + ".csv");
        await Common.mergeCsvFilesAsync(filepath1, filepath2, filepath3, true, "Id", "Name");
    }

    /**
     * Copy all source CSV files into the /source/ subdir
     * to leave the original files unchanged after
     * the validation and repairing
     *
     * @memberof MigrationJob
     */
    copyCSVFilesToSourceSubDir() {
        this.tasks.forEach(task => {
            fs.copyFileSync(task.cSVFilename, task.sourceCSVFilename);
        });
    }

    /**
     * Check and repair all CSV source files.
     *
     * @returns {Promise<void>}
     * @memberof MigrationJob
     */
    async validateAndRepairSourceCSVFiles(): Promise<void> {

        let self = this;

        // Analyse csv structure
        for (let index = 0; index < this.tasks.length; index++) {
            const task = this.tasks[index];
            this.csvIssues = this.csvIssues.concat(await task.validateCSV());
        }

        // if csv structure issues were found - prompt to abort the job 
        let abortWasPrompted = false;
        if (this.csvIssues.length > 0) {
            await ___abortwithPrompt();
            abortWasPrompted = true;
        }

        // Check and repair the source csvs
        for (let index = 0; index < this.tasks.length; index++) {
            const task = this.tasks[index];
            this.csvIssues = this.csvIssues.concat(await task.repairCSV(this.cachedCSVContent));
        }

        // Save the changed source csvs
        await this.saveCachedCsvDataFiles();
        this.logger.infoVerbose(RESOURCES.csvFilesWereUpdated, String(this.cachedCSVContent.updatedFilenames.size));

        // if csv data issues were found - prompt to abort the job 
        //  and save the report
        if (this.csvIssues.length > 0) {
            if (!abortWasPrompted) {
                await ___abortwithPrompt();
            } else {
                await self.saveCSVFileAsync(CONSTANTS.CSV_ISSUES_ERRORS_FILENAME, self.csvIssues);
                this.logger.warn(RESOURCES.issuesFoundDuringCSVValidation, String(this.csvIssues.length), CONSTANTS.CSV_ISSUES_ERRORS_FILENAME);
            }
        } else {
            this.logger.infoVerbose(RESOURCES.noIssuesFoundDuringCSVValidation);
        }

        async function ___abortwithPrompt(): Promise<void> {
            await Common.abortWithPrompt(self.logger,
                RESOURCES.issuesFoundDuringCSVValidation,
                self.script.promptOnIssuesInCSVFiles,
                RESOURCES.continueTheJobPrompt,
                "",
                async () => {
                    // Report csv issues
                    await self.saveCSVFileAsync(CONSTANTS.CSV_ISSUES_ERRORS_FILENAME, self.csvIssues);
                },
                String(self.csvIssues.length), CONSTANTS.CSV_ISSUES_ERRORS_FILENAME);
        }

    }


    /**
    * Retireve the total record count for each task in the job
    *
    * @returns {Promise<void>}
    * @memberof MigrationJob
    */
    async getTotalRecordsCount(): Promise<void> {
        for (let index = 0; index < this.tasks.length; index++) {
            const task = this.tasks[index];
            await task.getTotalRecordsCountAsync();
        }
    }

    /**
    * Delete old records of each task in the job
    *
    * @returns {Promise<void>}
    * @memberof MigrationJob
    */
    async deleteOldRecords(): Promise<boolean> {
        let deleted = false;
        for (let index = 0; index < this.tasks.length; index++) {
            const task = this.tasks[index];
            deleted = await task.deleteOldTargetRecords() || deleted;
        }
        return deleted;
    }

    /**
     * Queries records for all tasks in the job
     *
     * @returns {Promise<void>}
     * @memberof MigrationJob
     */
    async queryRecords(): Promise<void> {
        for (let index = 0; index < this.tasks.length; index++) {
            const task = this.tasks[index];
            await task.queryRecords();
        }
    }


    /**
     * Returns a task by the given sObject name
     *
     * @param {string} sObjectName The sobject name
     * @returns
     * @memberof MigrationJob
     */
    getTaskBySObjectName(sObjectName: string) {
        return this.tasks.filter(x => x.sObjectName == sObjectName)[0];
    }

    /**
     * Save csv file from the data of the input array
     *
     * @param {string} fileName It is just a filename (test.csv) not the full path
     * @param {Array<any>} data The data to write to csv file
     * @returns {Promise<void>}
     * @memberof MigrationJob
     */
    async saveCSVFileAsync(fileName: string, data: Array<any>): Promise<void> {
        let filePath = path.join(this.script.basePath, fileName);
        this.logger.infoVerbose(RESOURCES.writingToCSV, filePath);
        await Common.writeCsvFileAsync(filePath, data, true);
    }

    /**
     * Save all updated cached csv files
     *
     * @returns {Promise<any>}
     * @memberof MigrationJob
     */
    async saveCachedCsvDataFiles(): Promise<any> {
        let filePaths = [...this.cachedCSVContent.csvDataCacheMap.keys()];
        for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            if (this.cachedCSVContent.updatedFilenames.has(filePath)) {
                let csvData = this.cachedCSVContent.csvDataCacheMap.get(filePath);
                this.logger.infoVerbose(RESOURCES.writingToCSV, filePath);
                await Common.writeCsvFileAsync(filePath, [...csvData.values()], true);
            }
        }
    }

    /**
     * Clear cached csv data
     *
     * @memberof MigrationJob
     */
    clearCachedCSVData() {
        this.cachedCSVContent.clear();
    }




}



// --------------------------- Helper classes -------------------------------------
/**
 * The format of columns for a CSV issues report file
 *
 * @export
 * @interface ICSVIssues
 */
export interface ICSVIssues {
    "Date": string,
    "Child value": string,
    "Child sObject": string,
    "Child field": string,
    "Parent value": string,
    "Parent sObject": string,
    "Parent field": string,
    "Error": string
}

export class CachedCSVContent {

    constructor() {
        this.clear();
    }

    csvDataCacheMap: Map<string, Map<string, any>>;
    updatedFilenames: Set<string>;
    idCounter: number;


    /**
     * Generates next Id string in format I[DXXXXXXXXXXXXXXXX]
     * where XXXX... - is the next autonumber
     *
     * @readonly
     * @type {string}
     * @memberof CachedCSVContent
     */
    get nextId(): string {
        return "ID" + Common.addLeadnigZeros(this.idCounter++, 16);
    }


    /**
     * Clear all data
     *
     * @memberof CachedCSVContent
     */
    clear() {
        this.csvDataCacheMap = new Map<string, Map<string, any>>();
        this.updatedFilenames = new Set<string>();
        this.idCounter = 1;
    }
}