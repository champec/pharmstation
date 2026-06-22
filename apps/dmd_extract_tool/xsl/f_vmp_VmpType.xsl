<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
xmlns:fo="http://www.w3.org/1999/XSL/Format">
<xsl:output method="text" encoding="ASCII" />

<xsl:param name="delimiter" select=" '|' "/>

<xsl:template match="/*">
<xsl:apply-templates/>
</xsl:template>

<xsl:template match="//VMP">
<xsl:value-of select="VPID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="VPIDDT"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="VPIDPREV"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="VTMID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="INVALID"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NM"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="ABBREVNM"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="BASISCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NMDT"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NMPREV"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="BASIS_PREVCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NMCHANGECD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="COMBPRODCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PRES_STATCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="SUG_F"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="GLU_F"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="PRES_F"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="CFC_F"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NON_AVAILCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="NON_AVAILDT"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="DF_INDCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="UDFS"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="UDFS_UOMCD"/>
<xsl:value-of select="$delimiter"/>
<xsl:value-of select="UNIT_DOSE_UOMCD"/>

<xsl:text>&#xa;</xsl:text>
</xsl:template>
<xsl:template match="text()" />

</xsl:stylesheet>
