pipeline {
    agent { label 'mac-vpn' }

    parameters {
        choice(
            name: 'BRAND',
            choices: ['likes', 'booms', 'nix', 'igo', 'chacha', 'casho', 'starzino', 'gt', 'all'],
            description: 'Бренд для запуска'
        )
        choice(
            name: 'PLATFORM',
            choices: ['desktop', 'mobile'],
            description: 'Платформа прогона'
        )
        choice(
            name: 'PROFILE',
            choices: ['core', 'full', 'providers'],
            description: 'Набор тестов'
        )
        choice(
            name: 'BROWSER',
            choices: ['chromium'],
            description: 'Нативный Google Chrome через CDP'
        )
        booleanParam(
            name: 'USE_QA_ENV',
            defaultValue: false,
            description: 'Подключить Secret file credential с ID qa-env'
        )
        booleanParam(
            name: 'DRY_RUN',
            defaultValue: true,
            description: 'Проверить Pipeline без запуска тестов'
        )
    }

    environment {
        CI = 'true'
        HUSKY = '0'
        PW_REPORT_ALLURE = '1'
        ALLURE_RESULTS_DIR = 'allure-results'
        PW_CDP_REUSE_CONTEXT = '1'
        PW_USE_CHROME_CHANNEL = '1'
        PW_CDP_CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    }

    options {
        ansiColor('xterm')
        timestamps()
        disableConcurrentBuilds()
        buildDiscarder(logRotator(numToKeepStr: '20', artifactNumToKeepStr: '10'))
        timeout(time: 6, unit: 'HOURS')
        skipDefaultCheckout(true)
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Runtime check') {
            steps {
                sh '''
                    node --version
                    npx --yes npm@12.2.3 --version
                    test -x "$PW_CDP_CHROME_PATH"
                    test "$(node -p "process.versions.node.split('.')[0]")" = "24"
                    test "$(npx --yes npm@12.2.3 --version | cut -d. -f1)" = "12"
                '''
            }
        }

        stage('Install dependencies') {
            steps {
                sh 'npx --yes npm@12.2.3 ci'
            }
        }

        stage('Load QA credentials') {
            when {
                expression { params.USE_QA_ENV }
            }
            steps {
                withCredentials([file(credentialsId: 'qa-env', variable: 'QA_ENV_FILE')]) {
                    sh '''
                        cp "$QA_ENV_FILE" .env
                        chmod 600 .env
                    '''
                }
            }
        }

        stage('Run tests') {
            steps {
                script {
                    def dryRunArgument = params.DRY_RUN ? '--dry-run=1' : ''
                    sh """
                        PW_BROWSER='${params.BROWSER}' \\
                        node scripts/qa-brand-run.js \\
                          --brand='${params.BRAND}' \\
                          --mode='${params.PLATFORM}' \\
                          --profile='${params.PROFILE}' \\
                          ${dryRunArgument}
                    """
                }
            }
        }
    }

    post {
        always {
            script {
                sh '''
                    mkdir -p allure-results
                    cat > allure-results/environment.properties <<EOF
Brand=${BRAND}
Platform=${PLATFORM}
Profile=${PROFILE}
Browser=${BROWSER}
Build=${BUILD_NUMBER}
Git_commit=${GIT_COMMIT}
EOF
                '''

                def allureExitCode = sh(
                    returnStatus: true,
                    script: 'npx allure generate allure-results --clean -o allure-report'
                )

                if (allureExitCode == 0 && fileExists('allure-report/index.html')) {
                    publishHTML(target: [
                        allowMissing: false,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: 'allure-report',
                        reportFiles: 'index.html',
                        reportName: 'Allure Report',
                        reportTitles: 'StarsPartners QA'
                    ])
                } else {
                    echo "Allure report was not generated (exit code: ${allureExitCode})"
                }
            }

            junit(
                allowEmptyResults: true,
                keepLongStdio: true,
                testResults: 'projects/**/test-results/junit.xml,test-results/junit.xml'
            )

            archiveArtifacts(
                allowEmptyArchive: true,
                artifacts: 'allure-results/**,allure-report/**,playwright-report/**,projects/**/test-results/**,projects/**/artifacts/**,projects/**/Autotest report/**'
            )
        }

        cleanup {
            deleteDir()
        }
    }
}
