import com.sap.gateway.ip.core.customdev.util.Message
import java.text.SimpleDateFormat

/**
 * Script: HandleError.groovy
 * Purpose: Build a clear error notification body for the alert email
 * and preserve the failed payload in properties for the DLQ data store.
 */
def Message processData(Message msg) {

    def props = msg.getProperties()

    // ── Collect error information ──────────────────────────────────────────
    def errorMsg   = props.get("CamelExceptionCaught")?.toString()     ?: "Unknown error"
    def errorClass = props.get("CamelExceptionCaught")?.getClass()?.simpleName ?: "Exception"
    def msgId      = props.get("msgId")                                ?: "UNKNOWN"
    def orderId    = props.get("salesOrderId")                         ?: "UNKNOWN"
    def timestamp  = props.get("processingTimestamp")                  ?: new Date().toString()

    // ── Preserve original payload for DLQ (before we overwrite body) ──────
    def originalPayload = msg.getBody(String) ?: ""
    msg.setProperty("originalPayload",     originalPayload.take(5000)) // cap at 5KB
    msg.setProperty("errorMessage",        errorMsg.take(1000))
    msg.setProperty("errorClass",          errorClass)

    // ── Build plain-text email body ────────────────────────────────────────
    def emailBody = """
CPI Integration Error: S4 to Shroom - SalesOrder
=================================================

Message ID    : ${msgId}
Sales Order   : ${orderId}
Timestamp     : ${timestamp}
Error Class   : ${errorClass}

Error Message :
${errorMsg}

Last Known Payload (first 2000 chars):
${originalPayload.take(2000)}

-------------------------------------------------
Integration Flow : S4_to_Shroom_SalesOrder
Tenant           : ${System.getProperty("com.sap.cloud.tenant.id", "Unknown")}
Action Required  : Check DLQ data store S4_Shroom_DLQ for full payload
                   Entry ID: ${msgId}_FAILED
""".trim()

    msg.setBody(emailBody)

    return msg
}
