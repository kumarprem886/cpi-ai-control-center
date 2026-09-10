import com.sap.gateway.ip.core.customdev.util.Message
import java.text.SimpleDateFormat

/**
 * Script: SetProperties.groovy
 * Purpose: Set processing metadata on the exchange before any transformation.
 * Sets: msgId (unique), timestamp, sourceSystem, correlationId
 */
def Message processData(Message msg) {

    def props   = msg.getProperties()
    def headers = msg.getHeaders()

    // ── Unique message ID for audit trail ──────────────────────────────────
    def msgId = "S4SHROOM-" + UUID.randomUUID().toString().replace("-","").substring(0,12).toUpperCase()
    msg.setProperty("msgId", msgId)

    // ── Processing timestamp ───────────────────────────────────────────────
    def sdf = new SimpleDateFormat("yyyyMMddHHmmssSSS")
    sdf.setTimeZone(TimeZone.getTimeZone("UTC"))
    msg.setProperty("processingTimestamp", sdf.format(new Date()))

    // ── Source system identifier ───────────────────────────────────────────
    msg.setProperty("sourceSystem", "SAP-S4HANA")
    msg.setProperty("targetSystem", "SHROOM")

    // ── Carry through any correlation ID from inbound header ──────────────
    def inboundCorrelation = headers.get("X-Correlation-Id") ?: headers.get("X-Request-Id") ?: msgId
    msg.setProperty("correlationId", inboundCorrelation)

    // ── Log entry point ────────────────────────────────────────────────────
    def log = com.sap.gateway.ip.core.customdev.logging.MessageLog
    // Note: actual message log API available at runtime

    return msg
}
