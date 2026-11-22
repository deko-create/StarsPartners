import hudson.model.Node
import hudson.slaves.DumbSlave
import hudson.slaves.JNLPLauncher
import hudson.slaves.RetentionStrategy
import jenkins.model.Jenkins

def jenkins = Jenkins.get()
def nodeName = 'mac-vpn'
def remoteFs = '/Users/denyskozyr/.jenkins-agent/work'

if (jenkins.getNode(nodeName) == null) {
    def node = new DumbSlave(
        nodeName,
        'Native macOS QA agent using the host VPN and Google Chrome CDP',
        remoteFs,
        '1',
        Node.Mode.EXCLUSIVE,
        'mac-vpn',
        new JNLPLauncher(),
        new RetentionStrategy.Always(),
        []
    )
    jenkins.addNode(node)
    println("Created Jenkins node: ${nodeName}")
}

def computer = jenkins.getComputer(nodeName)
if (computer != null) {
    def secretFile = new File(jenkins.rootDir, 'secrets/mac-vpn-agent-secret')
    secretFile.parentFile.mkdirs()
    secretFile.text = computer.getJnlpMac() + System.lineSeparator()
    secretFile.setReadable(false, false)
    secretFile.setWritable(false, false)
    secretFile.setReadable(true, true)
    secretFile.setWritable(true, true)
}
